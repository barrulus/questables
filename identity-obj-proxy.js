module.exports = new Proxy({}, {
  get: (_target, key) => (key === 'default' ? {} : String(key)),
});
