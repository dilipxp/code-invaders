import * as vscode from 'vscode';
import { GameSession } from './gameSession';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeInvaders.start', () => GameSession.start(context)),
    vscode.commands.registerCommand('codeInvaders.exit', () => GameSession.exit()),
    { dispose: () => GameSession.disposeCurrent() },
  );
}

export function deactivate(): void {
  GameSession.disposeCurrent();
}
