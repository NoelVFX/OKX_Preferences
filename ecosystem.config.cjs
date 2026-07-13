module.exports = {
  apps: [
    {
      name: 'preferences-asp-web',
      script: 'server.js',
      interpreter: 'node',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '350M',
      time: true
    },
    {
      name: 'preferences-discord-concierge',
      script: 'agent_coordinator.py',
      interpreter: './.venv/bin/python',
      cwd: __dirname,
      env: {
        PYTHONUNBUFFERED: '1'
      },
      max_memory_restart: '350M',
      time: true
    }
  ]
};
