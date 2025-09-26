# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0](https://github.com/SocketDev/socket-packageurl-js/releases/tag/v1.1.0) - 2025-09-26

### Added
- **PackageURLBuilder**: Fluent API builder pattern for constructing PackageURL instances with method chaining
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
- Comprehensive development documentation including prerequisites and commands
- Project structure overview for easier navigation
- Testing guide with Vitest examples and patterns
- Development workflow documentation

### Changed
- Enhanced README with developer experience improvements
- Added features section highlighting key project benefits
- Improved documentation structure and readability
- Improved code quality with comprehensive fileoverview headers
- Enhanced main entry point exports structure
- Updated build scripts and linting configuration

### Fixed
- Various code quality improvements and lint fixes

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