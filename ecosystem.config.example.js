module.exports = {
  apps: [{
    name: 'Messages',
    script: 'node_modules/.bin/next',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      TRUSTED_HOMESERVER_HOSTS: 'matrix.org',
      ALLOWED_HOMESERVER_HOSTS: 'matrix.org',
    },
  }],
};
