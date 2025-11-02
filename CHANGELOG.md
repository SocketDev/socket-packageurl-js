# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.3](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.3.3) - 2025-11-01

### Fixed
- Fixed reference to external file in build

## [1.3.2](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.3.2) - 2025-11-01

### Changed
- Disabled minification in build output for improved readability and debugging

## [1.3.1](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.3.1) - 2025-10-21

### Changed
- Use @socketsecurity/lib under the hood

## [1.3.0](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.3.0) - 2025-10-06

### Added
- Re-exported `PURL_Type` enum from `@socketsecurity/registry` for type-safe package ecosystem identifiers
- Re-exported `EcosystemString` type for type annotations requiring valid PURL type strings
- Documentation and usage examples for `PURL_Type` enum in README

## [1.2.0](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.2.0) - 2025-10-04

### Added
- Type coverage configuration with 100% coverage requirement
- Comprehensive backward compatibility tests for validation functions

### Changed
- Converted validation functions to options pattern with backward compatibility
- Renamed normalizePath to normalizePurlPath with options pattern
- Refactored PackageURL types with explicit exports

### Fixed
- Fixed error handling and concurrency issues in test suite
- Improved type safety with typed arrays replacing any[]

## [1.1.6](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.6) - 2025-10-03

### Changed
- Enhanced TypeScript strictness with explicit `| undefined` for optional properties and parameters
- Added comprehensive JSDoc documentation for core classes
- Optimized build output by disabling source map generation

## [1.1.5](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.5) - 2025-09-30

### Added
- Type-specific validation for cocoapods package names
  - Name cannot contain whitespace
  - Name cannot contain plus (+) character
  - Name cannot begin with a period
- Type-specific validation for cpan package namespaces
  - Namespace must be UPPERCASE when present
- Type-specific validation for swid package qualifiers
  - Requires tag_id qualifier
  - tag_id must not be empty
  - GUID format tag_id must be lowercase

### Fixed
- Error message formatting in validateStrings function

## [1.1.4](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.4) - 2025-09-29

### Fixed
- Fixed publishing workflow to ensure dist folder is built before npm publish
- Changed prepublishOnly script to prevent accidental local publishing

## [1.1.3](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.3) - 2025-09-29

### Fixed
- Fixed tsgo transpilation bug that produced incorrect `exports.encodeComponent = void 0;` output

## [1.1.2](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.2) - 2025-09-27

### Changed
- Enhanced build performance and reliability
- Improved package stability

## [1.1.1](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.1) - 2025-09-26

### Changed
- Removed pnpm engine requirement from package.json

## [1.1.0](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.0) - 2025-09-26

### Added
- **PackageURLBuilder**: Fluent API for constructing PackageURL instances with method chaining
  - Static factory methods for common package types (npm, pypi, maven, gem, golang, cargo, nuget, composer)
  - Support for all PackageURL components: type, namespace, name, version, qualifiers, and subpath
  - `build()` method creates validated PackageURL instances
  - `from()` static method creates builders from existing PackageURL instances
- **UrlConverter**: URL conversion utilities for Package URLs
  - `toRepositoryUrl()` converts PackageURLs to repository URLs (supports 14+ package ecosystems)
  - `toDownloadUrl()` converts PackageURLs to download URLs for package artifacts
  - Support for multiple URL types: git, web, tarball, zip, jar, gem, wheel formats
  - `getAllUrls()` convenience method for getting both repository and download URLs
  - Type support checking with `supportsRepositoryUrl()` and `supportsDownloadUrl()`
- Support for parsing Package URLs that don't start with `pkg:` scheme
- Comprehensive documentation with usage examples

### Changed
- Enhanced documentation with improved structure and readability
- Added features section highlighting key benefits

### Fixed
- Various improvements and fixes

## [1.0.8](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.0.8) - 2025-09-01

### Changed
- Updated implementation for PackageURL specification changes

## [1.0.7](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.0.7) - 2025-08-15

### Fixed
- Bug fixes and stability improvements

## [1.0.1](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.0.1) - 2025-05-15

### Added
- Initial Socket.dev optimized package override implementation

## [1.0.0](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.0.0) - 2025-05-01

### Added
- Initial release of @socketregistry/packageurl-js
- Socket.dev optimized package override for packageurl-js
- Full compatibility with original packageurl-js API
