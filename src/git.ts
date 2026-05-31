import * as vscode from 'vscode';
import type { DiffSource } from './config';

// Интеграция с git идёт через встроенное расширение `vscode.git`, а не через ручной
// парсинг — это самый надёжный API. Ниже — минимальный контракт того, что нам нужно
// от репозитория (полный тип объявлен в API git-расширения).
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  /** Поле ввода commit-сообщения в панели Source Control — сюда кладём результат. */
  readonly inputBox: { value: string };
}

/** Возвращает первый репозиторий воркспейса или undefined, если git-репо нет. */
export function getActiveRepository(): GitRepository | undefined {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext?.isActive) {
    return undefined;
  }
  const api = ext.exports.getAPI(1); // версия git-API — 1
  if (!api.repositories.length) {
    return undefined;
  }
  // TODO (позже): при нескольких репозиториях выбрать активный (по фокусу SCM).
  return api.repositories[0];
}

// TODO (Фаза 1): получить diff в зависимости от источника
//   'staged' -> `git diff --cached`, 'all' -> `git diff HEAD`;
//   запускать через child_process в cwd репозитория, поднять maxBuffer,
//   а гигантский diff усечь на нашей стороне (input-guard) перед отправкой в CLI.
export async function getDiff(_cwd: string, _source: DiffSource): Promise<string> {
  throw new Error('getDiff: not implemented yet (Phase 1)');
}
