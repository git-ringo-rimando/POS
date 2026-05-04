const app = require('../server');
const { initDB } = require('../database');

let initPromise = null;

module.exports = async (req, res) => {
  if (!initPromise) initPromise = initDB();
  await initPromise;
  return app(req, res);
};
