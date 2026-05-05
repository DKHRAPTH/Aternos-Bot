const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bedrockBot = require('./function/bedrock');
const javaBot = require('./function/java');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

let activeEdition = null;
let botStatus = 'Disconnected';
let botStartTime = null;
let gameTime = 0;
let logHistory = [];
let hasOPPermission = null;
let dashboardTimer = null;
const MAX_LOGS = 50;

let autoRejoin = false;
let manualStop = false;
let currentConfig = null;

const sendLog = (msg) => {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const fullMsg = `[${timestamp}] ${msg}`;
  logHistory.push(fullMsg);
  if (logHistory.length > MAX_LOGS) logHistory.shift();
  io.emit('bot_log', fullMsg);
  console.log(fullMsg);
};

const getBotUptime = () => {
  if (!botStartTime) return '0h 0m 0s';
  const diff = Math.floor((Date.now() - botStartTime) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${h}h ${m}m ${s}s`;
};

const getInGameTime = (ticks) => {
  const timeOfDay = Number(BigInt(ticks || 0) % 24000n);
  if (timeOfDay >= 0 && timeOfDay < 12000) return 'Day';
  if (timeOfDay >= 12000 && timeOfDay < 13000) return 'Sunset';
  if (timeOfDay >= 13000 && timeOfDay < 23000) return 'Night';
  return 'Sunrise';
};

const startDashboardTimer = () => {
  if (dashboardTimer) clearInterval(dashboardTimer);
  dashboardTimer = setInterval(() => {
    io.emit('time_update', {
      uptime: getBotUptime(),
      gamePeriod: getInGameTime(gameTime)
    });
  }, 1000);
};

const stopDashboardTimer = () => {
  clearInterval(dashboardTimer);
  dashboardTimer = null;
  io.emit('time_update', {
    uptime: '0h 0m 0s',
    gamePeriod: '-'
  });
};

const updateStatus = (status) => {
  botStatus = status;
  io.emit('status_update', botStatus);
};

const botContext = {
  sendLog,
  updateStatus,
  setStartTime: (time) => botStartTime = time,
  setGameTime: (time) => gameTime = time,
  setOPPermission: (status) => {
    hasOPPermission = status;
    io.emit('op_status_update', status);
  },
  emit: (event, data) => io.emit(event, data),
  startDashboardTimer,
  stopDashboardTimer,
  handleDisconnect: () => {
    botStartTime = null;
    updateStatus('Disconnected');
    stopDashboardTimer();
    if (autoRejoin && !manualStop) {
      sendLog('Connection lost. Auto-rejoining in 5 seconds...');
      setTimeout(() => {
        if (!manualStop) startActiveBot();
      }, 5000);
    } else {
      activeEdition = null;
    }
  }
};

const startActiveBot = () => {
  manualStop = false;
  hasOPPermission = null;
  io.emit('op_status_update', null);
  if (activeEdition === 'bedrock') {
    bedrockBot.start(currentConfig, botContext);
  } else if (activeEdition === 'java') {
    javaBot.start(currentConfig, botContext);
  }
};

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('status_update', botStatus);
  socket.emit('log_history', logHistory);
  socket.emit('active_edition', activeEdition);
  socket.emit('op_status_update', hasOPPermission);

  socket.on('control_bot', (action, data) => {
    if (action === 'start') {
      currentConfig = {
        host: data.host || 'localhost',
        port: parseInt(data.port) || 19132,
        username: data.username || 'MinecraftBot',
        version: data.version || '1.20.1'
      };
      activeEdition = data.edition || 'bedrock';
      autoRejoin = data.autoRejoin || false;
      io.emit('active_edition', activeEdition);

      if (botStatus !== 'Disconnected') {
        manualStop = true;
        if (activeEdition === 'bedrock') bedrockBot.stop();
        else javaBot.stop();
        setTimeout(() => startActiveBot(), 1000);
      } else {
        startActiveBot();
      }
    }
    if (action === 'stop') {
      manualStop = true;
      autoRejoin = false;
      if (activeEdition === 'bedrock') bedrockBot.stop();
      else if (activeEdition === 'java') javaBot.stop();
      botContext.handleDisconnect();
      sendLog('Bot stopped by user.');
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  sendLog(`Dashboard running on port ${PORT}`);
  sendLog('Minecraft Bot Dashboard v2.0 Ready!');
});

process.on('SIGINT', () => {
  sendLog('Shutting down gracefully...');
  if (activeEdition === 'bedrock') bedrockBot.stop();
  if (activeEdition === 'java') javaBot.stop();
  server.close(() => {
    sendLog('Server closed.');
    process.exit(0);
  });
});