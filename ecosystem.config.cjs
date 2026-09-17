// PM2 — Família Steam
// Uso:
//   pm2 start ecosystem.config.cjs
//   pm2 status | pm2 logs fsteam | pm2 restart fsteam
//   pm2 save            # congela a lista atual (restaura com `pm2 resurrect`)
//   pm2 startup         # gera o comando para subir o pm2 no boot (rode o comando que ele imprimir)
module.exports = {
  apps: [
    {
      name: "fsteam",
      script: "./server.js",
      interpreter: "node",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 2000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        BIND: "127.0.0.1",
      },
    },
  ],
};
