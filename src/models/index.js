'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
let config = {};
try {
  const fullConfig = require(path.join(__dirname, '..', 'config', 'config.json'));
  config = fullConfig[env] || {};
} catch (err) {
  try {
    const localConfig = require(path.join(__dirname, '..', 'config', 'config-local.json'));
    config = localConfig[env] || {};
  } catch (err2) {
    config = {};
  }
}
const db = {};

let sequelize;
const dbHost = process.env.DB_HOST || config.host;
const dbUser = process.env.DB_USER || config.username;
const dbPassword = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : config.password;
const dbName = process.env.DB_NAME || config.database;
const dbPort = process.env.DB_PORT || config.port;

const options = {
  dialect: process.env.DB_DIALECT || config.dialect || 'mysql',
  ...config,
  host: dbHost
};

if (dbPort) {
  options.port = dbPort;
}

if (process.env.DB_SSL === 'true' || config.dialectOptions?.ssl) {
  options.dialectOptions = {
    ...options.dialectOptions,
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  };
}

sequelize = new Sequelize(dbName, dbUser, dbPassword, options);

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
