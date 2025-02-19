/** *******************************************************************
 * copyright (c) 2025 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import {expect} from 'chai';
import {ViewSection} from 'monaco-page-objects';
import {e2eContainer} from '../../configs/inversify.config';
import {CLASSES, TYPES} from '../../configs/inversify.types';
import {BASE_TEST_CONSTANTS} from '../../constants/BASE_TEST_CONSTANTS';
import {WorkspaceHandlingTests} from '../../tests-library/WorkspaceHandlingTests';
import {ProjectAndFileTests} from '../../tests-library/ProjectAndFileTests';
import {LoginTests} from '../../tests-library/LoginTests';
import {BrowserTabsUtil} from '../../utils/BrowserTabsUtil';
import {registerRunningWorkspace} from '../MochaHooks';
import {ITestWorkspaceUtil} from '../../utils/workspace/ITestWorkspaceUtil';
import {Dashboard} from '../../pageobjects/dashboard/Dashboard';
import {KubernetesCommandLineToolsExecutor} from '../../utils/KubernetesCommandLineToolsExecutor';
import {ShellExecutor} from '../../utils/ShellExecutor';
import {ShellString} from 'shelljs';

suite(
    `Test podman build and push container image ${BASE_TEST_CONSTANTS.TEST_ENVIRONMENT}`,
    function (): void {
        const loginTests: LoginTests = e2eContainer.get(CLASSES.LoginTests);
        const workspaceHandlingTests: WorkspaceHandlingTests = e2eContainer.get(CLASSES.WorkspaceHandlingTests);
        const projectAndFileTests: ProjectAndFileTests = e2eContainer.get(CLASSES.ProjectAndFileTests);
        const browserTabsUtil: BrowserTabsUtil = e2eContainer.get(CLASSES.BrowserTabsUtil);
        const testWorkspaceUtil: ITestWorkspaceUtil = e2eContainer.get(TYPES.WorkspaceUtil);
        const dashboard: Dashboard = e2eContainer.get(CLASSES.Dashboard);
        const shellExecutor: ShellExecutor = e2eContainer.get(CLASSES.ShellExecutor);

        let kubernetesCommandLineToolsExecutor: KubernetesCommandLineToolsExecutor;
        let workspaceName: string = '';

        const buildPushScript: string = `
echo "===== Podman Build and Push script ====="
export ARCH=$(uname -m)
export DATE=$(date +"%m%d%y")
export USER=$(oc whoami)
export TKN=$(oc whoami -t)
export REG="image-registry.openshift-image-registry.svc:5000"
export PROJECT=$(oc project -q)
export IMG="\${REG}/\${PROJECT}/hello:\${DATE}"

echo "Logging in to \${REG} ..."
podman login --tls-verify=false --username "\${USER}" --password "\${TKN}" "\${REG}"

echo "Building the container image ..."
podman build -t "\${IMG}" -f "Dockerfile.\${ARCH}" .

echo "Pushing the container image ..."
podman push --tls-verify=false "\${IMG}"

echo "===== Build & Push done ====="
`;

        const runTestScript: string = `
echo "===== Creating a test Pod from the built image ====="
export DATE=$(date +"%m%d%y")
export REG="image-registry.openshift-image-registry.svc:5000"
export PROJECT=$(oc project -q)
export IMG="\${REG}/\${PROJECT}/hello:\${DATE}"


echo "Creating new test pod..."
oc delete pod test-hello-pod --ignore-not-found
oc run test-hello-pod --restart=Never --image="\${IMG}"

echo "Waiting for pod to succeed..."
for i in {1..10}; do
  PHASE=$(oc get pod test-hello-pod -o jsonpath='{.status.phase}')
  if [[ "$PHASE" == "Succeeded" ]]; then
    echo "Pod succeeded"
    break
  elif [[ "$PHASE" == "Failed" ]]; then
    echo "Pod failed with status $PHASE"
    oc describe pod test-hello-pod
    exit 1
  fi
  echo "Pod status: $PHASE, waiting 6 seconds..."
  sleep 6
done

echo "===== Test pod logs ====="
oc logs test-hello-pod
`;

        const factoryUrl: string = 'https://github.com/crw-qe/dockerfile-hello-world';

        suiteSetup('Login into DevSpaces', async function (): Promise<void> {
            await loginTests.loginIntoChe();
        });

        test(`Create and open new workspace from repo: ${factoryUrl}`, async function (): Promise<void> {
            await dashboard.waitPage();
            await workspaceHandlingTests.createAndOpenWorkspaceFromGitRepository(factoryUrl);
            await workspaceHandlingTests.obtainWorkspaceNameFromStartingPage();
            workspaceName = WorkspaceHandlingTests.getWorkspaceName();
            expect(workspaceName, 'Workspace name was not detected').not.empty;
            registerRunningWorkspace(workspaceName);
        });

        test('Wait for workspace readiness', async function (): Promise<void> {
            await projectAndFileTests.waitWorkspaceReadinessForCheCodeEditor();
        });

        test('Check if the project files were imported', async function (): Promise<void> {
            const projectSection: ViewSection = await projectAndFileTests.getProjectViewSession();
            await new Promise((res) => setTimeout(res, 2000));

            const dockerfileName = 'Dockerfile.x86_64';
            const foundDockerfile = await projectAndFileTests.getProjectTreeItem(projectSection, dockerfileName);

            expect(foundDockerfile, `File ${dockerfileName} not found`).not.undefined;
        });

        test('Podman login, build, and push from inside workspace', function (): void {
            kubernetesCommandLineToolsExecutor = e2eContainer.get(CLASSES.KubernetesCommandLineToolsExecutor);
            kubernetesCommandLineToolsExecutor.workspaceName = workspaceName;
            kubernetesCommandLineToolsExecutor.loginToOcp();
            kubernetesCommandLineToolsExecutor.getPodAndContainerNames();
            const output: ShellString = kubernetesCommandLineToolsExecutor.execInContainerCommand(buildPushScript);
            expect(output.stdout).to.include('===== Build & Push done =====');
        });

        test('Verify test pod logs contain expected message', function (): void {
            const output: ShellString = shellExecutor.executeCommand(runTestScript);
            expect(output.stdout).to.include('Hello from Kubedock!', 'Expected "Hello from Kubedock!" message not found in logs');
        });

        suiteTeardown('Open dashboard and close all other tabs', async function (): Promise<void> {
            await dashboard.openDashboard();
            await browserTabsUtil.closeAllTabsExceptCurrent();
        });

        suiteTeardown('Stop and delete the workspace by API', async function (): Promise<void> {
            await testWorkspaceUtil.stopAndDeleteWorkspaceByName(workspaceName);
        });

        suiteTeardown('Unregister running workspace', function (): void {
            registerRunningWorkspace('');
        });
    }
);
