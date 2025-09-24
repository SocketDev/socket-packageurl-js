function isNullishOrEmptyString(value: any): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.length === 0)
  )
}

export { isNullishOrEmptyString }
