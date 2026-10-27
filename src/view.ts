import * as vscode from 'vscode';
import type { PeriodSummary, Summary } from './core/report';
import { formatDuration } from './core/time';

type Node =
  | { kind: 'period'; period: PeriodSummary; withDays: boolean }
  | { kind: 'row'; label: string; ms: number }
  | { kind: 'info'; label: string };

export class SummaryTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private summary: Summary | undefined;

  update(summary: Summary): void {
    this.summary = summary;
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.changed.dispose();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'period') {
      const item = new vscode.TreeItem(node.period.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = formatDuration(node.period.total);
      item.iconPath = new vscode.ThemeIcon('clock');
      if (node.period.label === 'Today') {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    if (node.kind === 'row') {
      item.description = formatDuration(node.ms);
    }
    return item;
  }

  getChildren(node?: Node): Node[] {
    const s = this.summary;
    if (!s) {
      return [{ kind: 'info', label: 'Loading...' }];
    }
    if (!node) {
      return [
        { kind: 'period', period: s.today, withDays: false },
        { kind: 'period', period: s.week, withDays: false },
        { kind: 'period', period: s.history, withDays: true },
      ];
    }
    if (node.kind !== 'period') {
      return [];
    }
    if (node.period.total === 0) {
      return [{ kind: 'info', label: 'Nothing tracked yet' }];
    }
    if (node.withDays) {
      return s.days.map((d): Node => ({ kind: 'row', label: d.day, ms: d.total }));
    }
    return node.period.byProject.map(([label, ms]): Node => ({ kind: 'row', label, ms }));
  }
}
