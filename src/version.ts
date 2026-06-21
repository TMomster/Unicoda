/** 当前应用版本 */
export const APP_VERSION = "0.1.0-alpha-06e4er4t53mk";

/** 版本记录在配置存储中的键名 */
export const VERSION_STORAGE_KEY = "unicoda-version";

/** 持久化的版本记录结构 */
export interface VersionRecord {
  version: string;
  downgradeDismissed: boolean;
}

/**
 * 比较两个版本号（取 major.minor.patch 前缀）。
 * @returns -1 若 v1 < v2, 0 若相等, 1 若 v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => {
    const parts = v.split(".").map((s) => {
      const m = s.match(/^(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    });
    while (parts.length < 3) parts.push(0);
    return parts;
  };
  const a = parse(v1);
  const b = parse(v2);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

/** 本版本的更新公告内容 */
export const UPDATE_CHANGELOG = `1. 新增文件读写模组
2. 知识库系统更新
3. 增强了独立任务处理能力
4. 新增德语界面语言支持
5. 新增偏好语言设置
6. 修复了若干已知问题`;
