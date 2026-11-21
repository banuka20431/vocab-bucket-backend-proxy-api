module.exports = {
  apps: [
    {
      name: "vocab-bucket-api",
      script: "./server.js",
      exec_mode: "fork",
      instances: 1,
      node_args: ["--max-old-space-size=256", "--env-file=.env"],
      max_memory_restart: "300M",
      kill_timeout: 5000,
      exp_backoff_restart_delay: 200,
      merge_logs: true,
      filter_env: true,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};