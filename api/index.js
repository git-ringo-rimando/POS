const app = require('../server');
const { initDB } = require('../database');

let initialized = false;

module.exports = async (req, res) => {
  if (!initialized) {
    await initDB();
    initialized = true;
  }
  return app(req, res);
};
