/**
 * @fileoverview Constants defining standard PURL qualifier names.
 * Provides repository_url, download_url, vcs_url, file_name, and checksum qualifier constants.
 */

// Known qualifiers:
// https://github.com/package-url/purl-spec/blob/master/PURL-SPECIFICATION.rst#known-qualifiers-keyvalue-pairs
const PurlQualifierNames = {
  __proto__: null,
  Checksum: 'checksum',
  DownloadUrl: 'download_url',
  FileName: 'file_name',
  RepositoryUrl: 'repository_url',
  VcsUrl: 'vcs_url',
  Vers: 'vers',
}

export { PurlQualifierNames }
