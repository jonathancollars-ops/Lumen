import { VersionBumpType } from '../types';

/**
 * Lumen App Version
 * Used for checking GitHub Releases
 */
export const APP_VERSION = '3.7.3';

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  build: number;
  raw: string;
}

/**
 * Cleans and parses a version string (e.g. "v3.1.0", "3.0.0-rc1", "3.2", "v3.3.0-build-54") into numeric components.
 */
export function parseSemver(versionString: string | null | undefined): ParsedSemver {
  if (!versionString || typeof versionString !== 'string') {
    return { major: 0, minor: 0, patch: 0, build: 0, raw: '0.0.0' };
  }

  // Remove leading 'refs/tags/', 'v' or 'V', and any surrounding whitespace
  const clean = versionString.trim().replace(/^refs\/tags\//i, '').replace(/^v/i, '');

  // Extract build number from tags (ex: v3.3.0-build-54, v3.3.1-build.54, v3.3.1-54, v3.3.1+54 -> build: 54)
  const buildMatch = clean.match(/build[-.]?(\d+)/i) || clean.match(/[-+](\d+)$/i);
  const build = buildMatch ? (parseInt(buildMatch[1], 10) || 0) : 0;

  // Extract major, minor, patch (ignoring prerelease suffixes like -beta or -build-54)
  const mainPart = clean.split('-')[0].split('+')[0];
  const parts = mainPart.split('.').map(p => {
    const num = parseInt(p, 10);
    return isNaN(num) ? 0 : Math.max(0, num);
  });

  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  return {
    major,
    minor,
    patch,
    build,
    raw: `${major}.${minor}.${patch}`
  };
}

/**
 * Compares two semantic version strings.
 * Conforms to SemVer 2.0 specification:
 * - Compares major, minor, patch.
 * - When major.minor.patch are equal:
 *   - If local version does not specify a build (p2.build === 0), it is considered the official final release.
 *     A remote build tag (e.g. v3.4.0-build-54) is NOT considered superior to the release.
 *   - If local has a build (p2.build > 0) and remote has no build (p1.build === 0), the official release is superior.
 *   - If both specify a build number, the higher build wins.
 * Returns:
 *   1 if v1 > v2 (v1 is newer)
 *  -1 if v1 < v2 (v1 is older)
 *   0 if v1 === v2 (equal or not newer)
 */
export function compareSemver(v1: string, v2: string): number {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (p1.major !== p2.major) {
    return p1.major > p2.major ? 1 : -1;
  }
  if (p1.minor !== p2.minor) {
    return p1.minor > p2.minor ? 1 : -1;
  }
  if (p1.patch !== p2.patch) {
    return p1.patch > p2.patch ? 1 : -1;
  }

  // When major.minor.patch are identical:
  // If local version did not specify a build number (p2.build === 0),
  // it is an official final release, so a remote pre-release/build tag (e.g. v3.4.0-build-XX)
  // must NOT be considered superior.
  if (p2.build === 0) {
    return 0;
  }

  // If local has an explicit build (p2.build > 0) and remote has no build (p1.build === 0),
  // the official final release (p1) is superior to the test build (p2).
  if (p1.build === 0 && p2.build > 0) {
    return 1;
  }

  if (p1.build !== p2.build) {
    return p1.build > p2.build ? 1 : -1;
  }
  return 0;
}


/**
 * Returns true if remoteVersion is strictly newer than currentVersion.
 */
export function isNewerVersion(remoteVersion: string, currentVersion: string = APP_VERSION): boolean {
  return compareSemver(remoteVersion, currentVersion) > 0;
}

/**
 * Calculates the next version string based on strict SemVer release rules:
 * - 'patch' (+0.0.1): Bugfixes, UI polish, minor styling corrections.
 * - 'minor' (+0.1.0): New features, screen additions, medium functional upgrades. Resets patch to 0.
 * - 'major' (+1.0.0): Major structural overhauls, breaking architecture shifts. Resets minor & patch to 0.
 */
export function bumpVersion(currentVersion: string, bumpType: VersionBumpType): string {
  const parsed = parseSemver(currentVersion);

  switch (bumpType) {
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'major':
      return `${parsed.major + 1}.0.0`;
    default:
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
}
