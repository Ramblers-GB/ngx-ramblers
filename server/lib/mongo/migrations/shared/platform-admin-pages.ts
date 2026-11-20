import { Document } from "mongodb";
import { isArray } from "es-toolkit/compat";
import { ActionButtonColumn, PageContentType } from "../../../../../projects/ngx-ramblers/src/app/models/content-text.model";
import {
  AdminPlatformPath,
  LEGACY_PLATFORM_PATH_REDIRECTS,
  LegacyAdminPlatformPath
} from "../../../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";

const PLATFORM_ADMIN_TITLE = "Platform Admin";
const LEGACY_PLATFORM_TITLES = ["Platform Administration", "Environment Management"];
const LEGACY_PREFIXES: { from: string; to: string }[] = [
  {from: `${LegacyAdminPlatformPath.ENVIRONMENT_MANAGEMENT}/`, to: `${AdminPlatformPath.ROOT}/`},
  {from: `${LegacyAdminPlatformPath.ROOT}/`, to: `${AdminPlatformPath.ROOT}/`}
];

export const LEGACY_PLATFORM_PAGE_PATH = `${LegacyAdminPlatformPath.ROOT}#action-buttons`;
export const LEGACY_ENVIRONMENT_MANAGEMENT_PAGE_PATH = `${LegacyAdminPlatformPath.ENVIRONMENT_MANAGEMENT}#action-buttons`;
export const PLATFORM_ADMIN_PAGE_PATH = `${AdminPlatformPath.ROOT}#action-buttons`;

function splitHref(href: string): { slash: string; path: string; rest: string } {
  const slash = href.startsWith("/") ? "/" : "";
  const withoutSlash = href.slice(slash.length);
  const restIndex = withoutSlash.search(/[?#]/);
  return restIndex >= 0
    ? {slash, path: withoutSlash.slice(0, restIndex), rest: withoutSlash.slice(restIndex)}
    : {slash, path: withoutSlash, rest: ""};
}

export function platformAdminHref(href: string | null | undefined): string | null | undefined {
  if (!href) {
    return href;
  } else {
    const {slash, path, rest} = splitHref(href.trim());
    const exact = LEGACY_PLATFORM_PATH_REDIRECTS[path as LegacyAdminPlatformPath];
    const prefix = LEGACY_PREFIXES.find(candidate => path.startsWith(candidate.from));
    const moved = exact || (prefix ? `${prefix.to}${path.slice(prefix.from.length)}` : null);
    return moved ? `${slash}${moved}${rest}` : href;
  }
}

export function platformAdminColumn<T extends { href?: string; title?: string; rows?: any[] }>(column: T): T {
  const href = platformAdminHref(column?.href);
  const pointsAtPlatformAdmin = splitHref(href || "").path === AdminPlatformPath.ROOT;
  const title = pointsAtPlatformAdmin && LEGACY_PLATFORM_TITLES.includes(column?.title) ? PLATFORM_ADMIN_TITLE : column?.title;
  const rows = isArray(column?.rows) ? platformAdminRows(column.rows) : column?.rows;
  return {...column, ...(column?.href !== undefined ? {href} : {}), ...(column?.title !== undefined ? {title} : {}), ...(column?.rows !== undefined ? {rows} : {})};
}

export function platformAdminRows(rows: any[]): any[] {
  return (rows || []).map(row => isArray(row?.columns) ? {...row, columns: row.columns.map((column: ActionButtonColumn) => platformAdminColumn(column))} : row);
}

function actionButtonColumns(document: Document | null): ActionButtonColumn[] {
  const row = (document?.rows || []).find(candidate => candidate?.type === PageContentType.ACTION_BUTTONS);
  return row?.columns || [];
}

function actionButtonRow(document: Document | null): any | null {
  return (document?.rows || []).find(candidate => candidate?.type === PageContentType.ACTION_BUTTONS) || null;
}

function uniqueByHref(columns: ActionButtonColumn[]): ActionButtonColumn[] {
  const seen = new Set<string>();
  return columns.filter(column => {
    const key = (column?.href || column?.title || "").trim();
    if (seen.has(key)) {
      return false;
    } else {
      seen.add(key);
      return true;
    }
  });
}

export function combinedPlatformAdminColumns(input: {
  platformAdmin: Document | null;
  legacyPlatform: Document | null;
  legacyEnvironmentManagement: Document | null;
}): ActionButtonColumn[] {
  const existing = actionButtonColumns(input.platformAdmin).map(platformAdminColumn);
  const environmentManagement = actionButtonColumns(input.legacyEnvironmentManagement).map(platformAdminColumn);
  const platform = actionButtonColumns(input.legacyPlatform)
    .map(platformAdminColumn)
    .filter(column => column.href !== AdminPlatformPath.ROOT);
  const cloudflareLast = [
    ...platform.filter(column => column.href !== AdminPlatformPath.CLOUDFLARE_WORKERS),
    ...platform.filter(column => column.href === AdminPlatformPath.CLOUDFLARE_WORKERS)
  ];
  return uniqueByHref([...existing, ...environmentManagement, ...cloudflareLast]);
}

export function platformAdminActionButtonsRow(input: {
  platformAdmin: Document | null;
  legacyEnvironmentManagement: Document | null;
}, columns: ActionButtonColumn[]): any {
  const template = actionButtonRow(input.legacyEnvironmentManagement) || actionButtonRow(input.platformAdmin) || {type: PageContentType.ACTION_BUTTONS, maxColumns: 2, showSwiper: false};
  return {...template, columns};
}
