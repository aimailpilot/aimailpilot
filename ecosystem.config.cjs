module.exports = {
  apps: [
    {
      name: 'aimailpilot',
      script: 'npx',
      args: 'tsx server/index.ts',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
