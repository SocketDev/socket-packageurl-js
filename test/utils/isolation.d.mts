/**
 * Returns the path to the built package for testing.
 *
 * @param _packagePath - Path to the package root directory.
 */
export function isolatePackage(
  _packagePath: string,
): Promise<{ pkgPath: string }>
