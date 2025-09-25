module.exports = {
  apps: [
    {
      name: "E6ai 2.0",
      script: "index.js",
      cwd: "/home/kebolder/discord/e6aibot2",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      restart_delay: 1000,
      max_memory_restart: "500M",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      env_production: {
        NODE_ENV: "production"
      }
    }
  ],
  deploy: {
    production: {
      user: "kebolder",
      host: "raspberrypi.local",
      ref: "origin/main",
      repo: "https://github.com/Kebolder/e6aibot2.git",
      path: "/home/kebolder/discord/e6aibot2",
      "post-deploy": "npm install && pm2 reload ecosystem.config.cjs"
    }
  }
};