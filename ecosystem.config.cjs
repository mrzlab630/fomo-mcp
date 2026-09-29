module.exports = {
  apps: [
    {
      name: "fomo-mcp-daemon",
      script: "dist/daemon.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        FOMO_MCP_RUNTIME_CONFIG: "./config/runtime.json",
        FOMO_MCP_AUTH_FILE: "./data/auth-state.enc.json"
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      kill_timeout: 5000,
      time: true,
      out_file: "./logs/daemon.out.log",
      error_file: "./logs/daemon.error.log",
      merge_logs: true,
      watch: false,
      env_production: {
        NODE_ENV: "production"
      }
    }
  ]
};
