import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let reassignDisposable = vscode.commands.registerCommand('hoi4.reassignProvinces', async () => {
        try {
            const provinceIds = await promptForProvinceIds();
            if (!provinceIds) return;
            const stateId = await promptForStateId('Enter the target state ID');
            if (!stateId) return;
            const statesDirPath = getStatesDirPath();
            if (!statesDirPath) return;
            await reassignProvinces(statesDirPath, provinceIds, stateId);
            vscode.window.showInformationMessage(`Successfully reassigned provinces ${provinceIds.join(', ')} to state ${stateId}.`);
        } catch (error) {
            handleError(error, 'Error reassigning provinces');
        }
    });

    let createStateDisposable = vscode.commands.registerCommand('hoi4.createState', async () => {
        try {
            const provinceIds = await promptForProvinceIds();
            if (!provinceIds) return;
            const stateName = await vscode.window.showInputBox({
                prompt: 'Enter the display name for the new state',
                placeHolder: 'Gerald',
                validateInput: value => value.trim() ? null : 'Please enter a state name.'
            });
            if (!stateName) return;
            const stateCategories = ['enclave', 'tiny_island', 'pastoral', 'small_island', 'rural', 'town', 'large_town', 'city', 'large_city', 'metropolis', 'megalopolis', 'wasteland'];
            const stateCategory = await vscode.window.showQuickPick(stateCategories, { placeHolder: 'Select the state category', canPickMany: false });
            if (!stateCategory) return;
            const statesDirPath = getStatesDirPath();
            if (!statesDirPath) return;
            const countryTags = await getCountryTags();
            const ownerTag = await vscode.window.showQuickPick(countryTags, { placeHolder: 'Select or type the owner country tag', canPickMany: false });
            if (!ownerTag) return;
            const coreTagsInput = await vscode.window.showInputBox({
                prompt: 'Enter space-separated country tags for cores',
                placeHolder: 'ITA GER',
                validateInput: value => {
                    if (!value.trim()) return null;
                    const tags = value.trim().split(/\s+/);
                    for (const tag of tags) {
                        if (!/^[A-Z0-9]{3}$/.test(tag)) return `Invalid tag: "${tag}". Tags must be 3-character codes.`;
                    }
                    return null;
                }
            });
            const coreTags = coreTagsInput ? coreTagsInput.trim().split(/\s+/).map(tag => tag.trim()) : [];
            const newStateId = await getNextStateId(statesDirPath);
            if (!newStateId) {
                vscode.window.showErrorMessage('Could not determine the next state ID.');
                return;
            }
            const stateContent = generateStateContent(newStateId, stateCategory, ownerTag, coreTags, provinceIds);
            const newFileName = `${newStateId}-NewState.txt`;
            const newFilePath = path.join(statesDirPath, newFileName);
            fs.writeFileSync(newFilePath, stateContent, 'utf8');
            const localisationFilePath = getLocalisationFilePath();
            if (localisationFilePath) {
                appendStateName(localisationFilePath, newStateId, stateName);
            } else {
                vscode.window.showWarningMessage('Localization file not found or inaccessible.');
            }
            await reassignProvinces(statesDirPath, provinceIds, newStateId.toString());
            vscode.window.showInformationMessage(`Created state ${newStateId} "${stateName}" with provinces ${provinceIds.join(', ')} in "${newFileName}".`);
        } catch (error) {
            handleError(error, 'Error creating state');
        }
    });

    context.subscriptions.push(reassignDisposable, createStateDisposable);
}

async function promptForProvinceIds(): Promise<string[] | undefined> {
    const provinceInput = await vscode.window.showInputBox({
        prompt: 'Enter province IDs (space-separated)',
        placeHolder: '1234 5678',
        validateInput: value => {
            if (!value.trim()) return 'Please enter at least one province ID.';
            const ids = value.trim().split(/\s+/);
            for (const id of ids) {
                if (!/^\d+$/.test(id)) return `Invalid province ID: "${id}". IDs must be positive integers.`;
            }
            return null;
        }
    });
    return provinceInput ? provinceInput.trim().split(/\s+/).map(id => id.trim()) : undefined;
}

async function promptForStateId(prompt: string): Promise<string | undefined> {
    return await vscode.window.showInputBox({
        prompt,
        placeHolder: '106',
        validateInput: value => {
            if (!value.trim()) return 'Please enter a state ID.';
            if (!/^\d+$/.test(value)) return 'State ID must be a positive integer.';
            return null;
        }
    });
}

function getStatesDirPath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return undefined;
    }
    const config = vscode.workspace.getConfiguration('hoi4ProvinceReassigner');
    const defaultStatesDir = 'history/states';
    const statesDir = config.get<string>('statesDirectory', defaultStatesDir);
    const statesDirPath = path.join(workspaceFolders[0].uri.fsPath, statesDir);
    if (!fs.existsSync(statesDirPath) || !fs.statSync(statesDirPath).isDirectory()) {
        vscode.window.showErrorMessage(`States directory "${statesDir}" does not exist or is not a directory.`);
        return undefined;
    }
    return statesDirPath;
}

function getLocalisationFilePath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return undefined;
    }
    const config = vscode.workspace.getConfiguration('hoi4ProvinceReassigner');
    const defaultLocalisationFile = 'localisation/state_names_l_english.yml';
    const localisationFile = config.get<string>('localisationFile', defaultLocalisationFile);
    const localisationFilePath = path.join(workspaceFolders[0].uri.fsPath, localisationFile);
    const localisationDir = path.dirname(localisationFilePath);
    if (!fs.existsSync(localisationDir)) {
        try {
            fs.mkdirSync(localisationDir, { recursive: true });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create localisation directory "${localisationDir}".`);
            return undefined;
        }
    }
    return localisationFilePath;
}

function appendStateName(filePath: string, stateId: number, stateName: string) {
    const entry = ` STATE_${stateId}:0 "${stateName}"\n`;
    vscode.window.showInformationMessage(`Attempting to append to: ${filePath}`);
    try {
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf8');
            vscode.window.showInformationMessage(`File content starts with: ${content.slice(0, 20).replace(/\n/g, '\\n')}`);
            // Skip strict l_english: check to avoid blocking
            // Ensure file ends with a newline
            if (!content.endsWith('\n')) {
                content += '\n';
                fs.writeFileSync(filePath, content, 'utf8');
                vscode.window.showInformationMessage(`Added newline to end of file`);
            }
            fs.appendFileSync(filePath, entry, 'utf8');
            vscode.window.showInformationMessage(`Appended state name: ${entry.trim()}`);
        } else {
            fs.writeFileSync(filePath, `l_english:\n${entry}`, 'utf8');
            vscode.window.showInformationMessage(`Created new localization file: ${filePath}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to append to localization file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function getCountryTags(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];
    const tagsDir = path.join(workspaceFolders[0].uri.fsPath, 'common/country_tags');
    if (!fs.existsSync(tagsDir) || !fs.statSync(tagsDir).isDirectory()) {
        return [];
    }
    const tagFiles = fs.readdirSync(tagsDir).filter(file => file.endsWith('.txt'));
    const tags: string[] = [];
    for (const file of tagFiles) {
        const content = fs.readFileSync(path.join(tagsDir, file), 'utf8');
        const tagMatches = content.matchAll(/^\s*([A-Z0-9]{3})\s*=/gm);
        for (const match of tagMatches) {
            if (match[1]) tags.push(match[1]);
        }
    }
    return tags.sort();
}

async function getNextStateId(statesDir: string): Promise<number | undefined> {
    const files = fs.readdirSync(statesDir).filter(file => file.endsWith('.txt'));
    let maxId = 0;
    for (const file of files) {
        const content = fs.readFileSync(path.join(statesDir, file), 'utf8');
        const idMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
        if (idMatch && idMatch[1]) {
            const id = parseInt(idMatch[1], 10);
            if (id > maxId) maxId = id;
        }
    }
    return maxId + 1;
}

function generateStateContent(id: number, stateCategory: string, ownerTag: string, coreTags: string[], provinceIds: string[]): string {
    const coreEntries = coreTags.length > 0 ? coreTags.map(tag => `\t\tadd_core_of = ${tag}`).join('\n') : '';
    return `state={
\tid = ${id}
\tname = "STATE_${id}"
\tmanpower = 1
\tstate_category = ${stateCategory}
\thistory={
\t\towner = ${ownerTag}
${coreEntries}
\t}
\tprovinces={
\t\t${provinceIds.join(' ')}
\t}
}`;
}

async function reassignProvinces(statesDir: string, provinceIds: string[], targetStateId: string) {
    const files = fs.readdirSync(statesDir).filter(file => file.endsWith('.txt'));
    let targetFilePath: string | null = null;
    let targetContent: string | null = null;
    for (const file of files) {
        const filePath = path.join(statesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const stateIdMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
        if (stateIdMatch && stateIdMatch[1] === targetStateId) {
            targetFilePath = filePath;
            targetContent = content;
            const provincesRegex = /provinces\s*=\s*{[^}]*}/;
            if (!provincesRegex.test(content)) {
                vscode.window.showErrorMessage(`Target state ${targetStateId} in file "${file}" is missing a provinces block.`);
                return;
            }
            break;
        }
    }
    if (!targetFilePath || !targetContent) {
        vscode.window.showErrorMessage(`Could not find a state file for state ID ${targetStateId} in "${statesDir}".`);
        return;
    }
    for (const file of files) {
        const filePath = path.join(statesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const stateIdMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
        if (!stateIdMatch) continue;
        const currentStateId = stateIdMatch[1];
        const provincesRegex = /(provinces\s*=\s*{[^}]*})/;
        const provincesMatch = content.match(provincesRegex);
        if (!provincesMatch) {
            if (currentStateId === targetStateId) {
                vscode.window.showErrorMessage(`Target state ${targetStateId} in file "${file}" is missing a provinces block.`);
                return;
            }
            continue;
        }
        let provincesBlock = provincesMatch[1];
        let provinceList: string[] = (provincesBlock.match(/\d+/g) || []).map(String);
        provinceList = provinceList.filter(id => !provinceIds.includes(id));
        if (currentStateId === targetStateId) {
            provinceList.push(...provinceIds);
            provinceList.sort((a, b) => parseInt(a) - parseInt(b));
        }
        const newProvincesBlock = `provinces={\n\t${provinceList.join(' ')}\n}`;
        const newContent = content.replace(provincesRegex, newProvincesBlock);
        fs.writeFileSync(filePath, newContent, 'utf8');
    }
}

function handleError(error: unknown, prefix: string) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${prefix}: ${errorMessage}`);
}

export function deactivate() {}