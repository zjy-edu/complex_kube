const keys = require('./keys');

// Express App Setup
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres Client Setup
const { Pool } = require('pg');
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  ssl:
    process.env.NODE_ENV !== 'production' || process.env.PGSSLMODE === 'disable'
      ? false
      : { rejectUnauthorized: false },
});

pgClient.on('error', (err) => {
  console.error('Postgres client error', err);
});

pgClient.on('connect', (client) => {
  client
    .query('CREATE TABLE IF NOT EXISTS values (number INT)')
    .catch((err) => console.error(err));
});

// Redis Client Setup
const redis = require('redis');
const redisClient = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000,
});
const redisPublisher = redisClient.duplicate();

redisClient.on('error', (err) => {
  console.error('Redis client error', err);
});

redisPublisher.on('error', (err) => {
  console.error('Redis publisher error', err);
});

// Express route handlers

app.get('/', (req, res) => {
  res.send('Hi');
});

app.get('/health', (req, res) => {
  res.send({ status: 'ok' });
});

app.get('/values/all', async (req, res) => {
  try {
    const values = await pgClient.query('SELECT * from values');
    res.send(values.rows);
  } catch (err) {
    console.error('Failed to fetch values from Postgres', err);
    res.status(500).send('Unable to fetch indexes');
  }
});

app.get('/values/current', async (req, res) => {
  redisClient.hgetall('values', (err, values) => {
    if (err) {
      console.error('Failed to fetch values from Redis', err);
      return res.status(500).send('Unable to fetch calculated values');
    }

    res.send(values);
  });
});

app.post('/values', async (req, res) => {
  const index = req.body.index;

  // Validate input
  if (!index || isNaN(index)) {
    return res.status(400).send('Index must be a number');
  }

  if (parseInt(index) > 40) {
    return res.status(422).send('Index too high');
  }

  redisClient.hset('values', index, 'Nothing yet!');
  redisPublisher.publish('insert', index);
  pgClient
    .query('INSERT INTO values(number) VALUES($1)', [index])
    .catch((err) => console.error('Failed to insert value into Postgres', err));

  res.send({ working: true });
});

app.listen(5000, (err) => {
  console.log('Listening');
});
