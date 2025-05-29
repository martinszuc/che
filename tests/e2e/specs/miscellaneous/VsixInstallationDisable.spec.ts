/** *******************************************************************
 * copyright (c) 2025 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import 'reflect-metadata';
import { e2eContainer } from '../../configs/inversify.config';
import { CLASSES, TYPES } from '../../configs/inversify.types';
import { expect } from 'chai';
import YAML from 'yaml';
import * as fs from 'fs';
import * as path from 'path';

import { WorkspaceHandlingTests } from '../../tests-library/WorkspaceHandlingTests';
import { ProjectAndFileTests } from '../../tests-library/ProjectAndFileTests';
import { LoginTests } from '../../tests-library/LoginTests';
import { registerRunningWorkspace } from '../MochaHooks';

import { KubernetesCommandLineToolsExecutor } from '../../utils/KubernetesCommandLineToolsExecutor';
import { ShellExecutor } from '../../utils/ShellExecutor';
import { ITestWorkspaceUtil } from '../../utils/workspace/ITestWorkspaceUtil';

import { ActivityBar, By, Key, WebElement } from 'monaco-page-objects';
import { Dashboard } from '../../pageobjects/dashboard/Dashboard';

import { DriverHelper } from '../../utils/DriverHelper';
import { BrowserTabsUtil } from '../../utils/BrowserTabsUtil';
import { BASE_TEST_CONSTANTS } from '../../constants/BASE_TEST_CONSTANTS';
import { Logger } from '../../utils/Logger';

suite(`Verify VSIX installation can be disabled via configuration ${BASE_TEST_CONSTANTS.TEST_ENVIRONMENT}`, function (): void {
	const workspaceHandlingTests: WorkspaceHandlingTests = e2eContainer.get(CLASSES.WorkspaceHandlingTests);
	const projectAndFileTests: ProjectAndFileTests = e2eContainer.get(CLASSES.ProjectAndFileTests);
	const loginTests: LoginTests = e2eContainer.get(CLASSES.LoginTests);
	const kubernetesCommandLineToolsExecutor: KubernetesCommandLineToolsExecutor = e2eContainer.get(
		CLASSES.KubernetesCommandLineToolsExecutor
	);
	const shellExecutor: ShellExecutor = e2eContainer.get(CLASSES.ShellExecutor);
	const testWorkspaceUtil: ITestWorkspaceUtil = e2eContainer.get(TYPES.WorkspaceUtil);
	const dashboard: Dashboard = e2eContainer.get(CLASSES.Dashboard);
	const driverHelper: DriverHelper = e2eContainer.get(CLASSES.DriverHelper);
	const browserTabsUtil: BrowserTabsUtil = e2eContainer.get(CLASSES.BrowserTabsUtil);

	const testRepoUrl: string = 'https://github.com/RomanNikitenko/web-nodejs-sample/tree/install-from-vsix-disabled-7-100';
	const vsixFileName: string = 'redhat.vscode-yaml-1.17.0.vsix';
	const configMapNamespace: string = 'openshift-devspaces';
	const configMapName: string = 'vscode-editor-configurations';
	const resourcesPath: string = path.join(__dirname, '../../../resources');

	let workspaceName: string = '';
	let originalConfigMapExists: boolean = false;
	let originalConfigMapContent: string = '';

	const EXTENSIONS_VIEW_SELECTOR: By = By.css('.extensions-viewlet');
	const VIEWS_MORE_ACTIONS_BUTTON: By = By.css('.action-label.codicon.codicon-toolbar-more[aria-label="Views and More Actions..."]');
	const COMMAND_PALETTE_CONTAINER: By = By.css('.quick-input-widget');
	const COMMAND_PALETTE_LIST: By = By.css('.monaco-list');
	const COMMAND_PALETTE_ITEMS: By = By.css('.monaco-list-row');
	const QUICK_PICK_INSTALL_FROM_VSIX: By = By.xpath(
		"//div[contains(@class,'monaco-list-row')]//span[contains(text(),'Install from VSIX')] | //div[contains(@class,'monaco-list-row')][contains(@aria-label,'Install from VSIX')]"
	);
	const VSIX_CONTEXT_MENU_ITEM: By = By.xpath('"//span[@aria-label=\'Install Extension VSIX\']"');
	const MONACO_MENU: By = By.css('.monaco-menu');
	const CONTEXT_MENU_ITEMS: By = By.css('.monaco-menu .action-label');

	function getConfigMapPath(filename: string): string {
		return path.join(resourcesPath, filename);
	}

	function applyConfigMap(configFile: string): void {
		const configPath: string = getConfigMapPath(configFile);
		const configContent: string = fs.readFileSync(configPath, 'utf8');
		shellExecutor.executeCommand(`oc apply -f - <<EOF\n${configContent}\nEOF`);
	}

	async function checkCommandPaletteForVsix(shouldExist: boolean): Promise<void> {
		try {
			await driverHelper.getDriver().actions().keyDown(Key.F1).keyUp(Key.F1).perform();

			const paletteVisible: boolean = await driverHelper.waitVisibilityBoolean(COMMAND_PALETTE_CONTAINER, 5, 1000);
			if (!paletteVisible) {
				await driverHelper
					.getDriver()
					.actions()
					.keyDown(Key.CONTROL)
					.keyDown(Key.SHIFT)
					.sendKeys('p')
					.keyUp(Key.SHIFT)
					.keyUp(Key.CONTROL)
					.perform();
			}

			await driverHelper.getDriver().actions().sendKeys('Install from VSIX').perform();

			const listVisible: boolean = await driverHelper.waitVisibilityBoolean(COMMAND_PALETTE_LIST, 5, 1000);
			if (listVisible) {
				const items: WebElement[] = await driverHelper.getDriver().findElements(COMMAND_PALETTE_ITEMS);
				const itemTexts: string[] = [];

				for (const item of items) {
					try {
						const itemText: string = (await item.getAttribute('aria-label')) || '';
						itemTexts.push(itemText);
						const hasVsixText: boolean = itemText.toLowerCase().includes('install from vsix');
						expect(hasVsixText).to.equal(shouldExist);
					} catch (e) {
						// continue
					}
				}

				Logger.info(`Command palette items found: ${itemTexts.join(', ')}`);

				const hasVsixItem: boolean = await driverHelper.waitVisibilityBoolean(QUICK_PICK_INSTALL_FROM_VSIX, 5, 1000);
				expect(hasVsixItem).to.equal(shouldExist);
			}
		} finally {
			await driverHelper.getDriver().actions().sendKeys(Key.ESCAPE).perform();
		}
	}

	async function checkExtensionsViewForVsix(shouldExist: boolean): Promise<void> {
		try {
			const viewCtrl: any = await new ActivityBar().getViewControl('Extensions');
			await viewCtrl?.openView();

			const extensionsViewVisible: boolean = await driverHelper.waitVisibilityBoolean(EXTENSIONS_VIEW_SELECTOR, 10, 1000);
			if (!extensionsViewVisible) {
				throw new Error('Extensions view could not be opened');
			}

			const moreActionsButton: WebElement = await driverHelper.getDriver().findElement(VIEWS_MORE_ACTIONS_BUTTON);
			if (!(await moreActionsButton.isDisplayed())) {
				throw new Error('More actions button not visible');
			}

			await moreActionsButton.click();

			const menuItems: WebElement[] = await driverHelper.getDriver().findElements(By.css('.monaco-menu .action-item'));
			const menuTexts: string[] = [];
			let vsixOptionPresent: boolean = false;

			for (const item of menuItems) {
				try {
					const text: string = await item.getText();
					menuTexts.push(text);
					if (text.includes('Install from VSIX')) {
						vsixOptionPresent = true;
					}
				} catch (err) {
					// continue
				}
			}

			Logger.info(`Extensions view menu items: ${menuTexts.join(', ')}`);
			expect(vsixOptionPresent).to.equal(shouldExist);
		} finally {
			await driverHelper.getDriver().actions().sendKeys(Key.ESCAPE).perform();
		}
	}

	async function checkExplorerContextMenuForVsix(shouldExist: boolean): Promise<void> {
		try {
			const explorerCtrl: any = await new ActivityBar().getViewControl('Explorer');
			await explorerCtrl?.openView();
			const projectSection: any = await projectAndFileTests.getProjectViewSession();
			if (!projectSection) {
				throw new Error('Failed to get project tree section');
			}

			const vsixFileItem: any = await projectSection.findItem(vsixFileName);
			if (!vsixFileItem) {
				Logger.warn(`Could not find ${vsixFileName} file in explorer`);
				return;
			}
			await vsixFileItem.openContextMenu();
			const menuVisible: boolean = await driverHelper.waitVisibilityBoolean(MONACO_MENU, 5, 1000);

			if (!menuVisible) {
				throw new Error('Context menu not visible after right-click');
			}

			const contextMenuItems: WebElement[] = await driverHelper.getDriver().findElements(CONTEXT_MENU_ITEMS);
			const contextMenuTexts: string[] = [];

			for (const item of contextMenuItems) {
				try {
					// try both text content and aria-label
					let text: string = await item.getText();
					if (!text.trim()) {
						text = (await item.getAttribute('aria-label')) || '';
					}
					if (text.trim()) {
						contextMenuTexts.push(text.trim());
					}
				} catch (err) {
					// continue
				}
			}

			Logger.info(`Context menu items: ${contextMenuTexts.join(', ')}`);

			// check for VSIX item with enhanced selector
			const installVsixPresent: boolean = await driverHelper.waitVisibilityBoolean(VSIX_CONTEXT_MENU_ITEM, 5, 1000);
			expect(installVsixPresent).to.equal(shouldExist);

			await driverHelper.getDriver().actions().sendKeys(Key.ESCAPE).perform();
		} catch (error) {
			Logger.error(`Error in context menu test: ${error}`);
			throw error;
		}
	}

	suiteSetup('Backup original editor configuration', function (): void {
		kubernetesCommandLineToolsExecutor.loginToOcp('admin');
		const cmd: string = `oc get configmap ${configMapName} -n ${configMapNamespace} -o jsonpath="{.data.configurations\\.json}" 2>/dev/null || echo NOT_FOUND`;
		const cfg: string = shellExecutor.executeCommand(cmd).stdout.trim();
		if (cfg !== 'NOT_FOUND') {
			originalConfigMapExists = true;
			originalConfigMapContent = cfg;
			Logger.info('Existing ConfigMap backed up');
		}
	});

	suiteSetup('Apply ConfigMap that disables VSIX installation', function (): void {
		applyConfigMap('configmap-disable-vsix-installation.yaml');
	});

	suiteSetup('Login', async function (): Promise<void> {
		await loginTests.loginIntoChe();
	});

	test('Create and open workspace from Git repository', async function (): Promise<void> {
		await workspaceHandlingTests.createAndOpenWorkspaceFromGitRepository(testRepoUrl);
		await workspaceHandlingTests.obtainWorkspaceNameFromStartingPage();
		workspaceName = WorkspaceHandlingTests.getWorkspaceName();
		registerRunningWorkspace(workspaceName);
	});

	test('Wait workspace readiness', async function (): Promise<void> {
		await projectAndFileTests.waitWorkspaceReadinessForCheCodeEditor();
		await projectAndFileTests.performTrustAuthorDialog();
	});

	test('Verify VSIX installation is disabled', async function (): Promise<void> {
		await checkCommandPaletteForVsix(false);
		await checkExtensionsViewForVsix(false);
		await checkExplorerContextMenuForVsix(false);
	});

	test('Enable VSIX installation and verify functionality returns', async function (): Promise<void> {
		applyConfigMap('configmap-enable-vsix-installation.yaml');

		// stop and delete the current workspace
		await dashboard.openDashboard();
		await testWorkspaceUtil.stopAndDeleteWorkspaceByName(workspaceName);
		registerRunningWorkspace('');

		Logger.info('Waiting for new ConfigMap settings to take effect...');
		await driverHelper.wait(15000);

		// create a new workspace from the same repository to pick up new ConfigMap settings
		await workspaceHandlingTests.createAndOpenWorkspaceFromGitRepository(testRepoUrl);
		await workspaceHandlingTests.obtainWorkspaceNameFromStartingPage();
		workspaceName = WorkspaceHandlingTests.getWorkspaceName();
		registerRunningWorkspace(workspaceName);

		await projectAndFileTests.waitWorkspaceReadinessForCheCodeEditor();
		await projectAndFileTests.performTrustAuthorDialog();

		await checkCommandPaletteForVsix(true);
		await checkExtensionsViewForVsix(true);
		await checkExplorerContextMenuForVsix(true);
	});

	suiteTeardown('Restore original configuration', function (): void {
		if (originalConfigMapExists) {
			const restoredYaml: string = YAML.stringify({
				apiVersion: 'v1',
				kind: 'ConfigMap',
				metadata: {
					name: configMapName,
					namespace: configMapNamespace,
					labels: {
						'app.kubernetes.io/part-of': 'che.eclipse.org',
						'app.kubernetes.io/component': 'workspaces-config'
					}
				},
				data: {
					'configurations.json': originalConfigMapContent
				}
			});
			shellExecutor.executeCommand(`oc apply -f - <<EOF\n${restoredYaml}\nEOF`);
			Logger.info('Original ConfigMap restored');
		} else {
			shellExecutor.executeCommand(`oc delete configmap ${configMapName} -n ${configMapNamespace} --ignore-not-found=true`);
			Logger.info('ConfigMap deleted as no original existed');
		}
	});

	suiteTeardown('Cleanup workspace', async function (): Promise<void> {
		await dashboard.openDashboard();
		await browserTabsUtil.closeAllTabsExceptCurrent();
		await testWorkspaceUtil.stopAndDeleteWorkspaceByName(workspaceName);
		registerRunningWorkspace('');
	});
});
