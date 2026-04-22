const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bedrock = require('bedrock-protocol');
const mineflayer = require('mineflayer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

// ============================================
// ⚙️ GLOBAL STATE (Resource-efficient)
// ============================================
let activeClient = null;
let activeEdition = null; // 'java' or 'bedrock'
let botStatus = 'Disconnected';
let botStartTime = null;
let gameTime = 0;
let logHistory = [];
let hasOPPermission = null; // null = unknown, true = has OP, false = no OP
let dashboardTimer = null;
const MAX_LOGS = 50;
// ============================================
// 📝 LOGGING SYSTEM
// ============================================
const sendLog = (msg) => {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const fullMsg = `[${timestamp}] ${msg}`;
  logHistory.push(fullMsg);
  if (logHistory.length > MAX_LOGS) logHistory.shift();
  io.emit('bot_log', fullMsg);
  console.log(fullMsg);
};

// ============================================
// 👑 OP PERMISSION CHECKER
// ============================================
const checkOPStatus = async () => {
  if (!activeClient || botStatus !== 'Connected') {
    hasOPPermission = null;
    return false;
  }

  try {
    sendLog('👑 Checking OP Status...');

    if (activeEdition === 'bedrock') {
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          sendLog('⚠️ OP Check timed out - Assuming NO OP');
          hasOPPermission = false;
          io.emit('op_status_update', false);
          resolve(false);
        }, 3000);

        // ฟังเฉพาะ CommandOutput packet
        const listener = (packet) => {
          if (packet.name === 'command_output') {
            clearTimeout(timeout);
            activeClient.off('packet', listener);
            
            // ตรวจสอบว่าสำเร็จหรือไม่ (SuccessCount > 0 คือมี OP)
            const isOP = packet.params.success_count > 0;
            hasOPPermission = isOP;
            sendLog(isOP ? '✅ OP Status: YES!' : '❌ OP Status: NO');
            io.emit('op_status_update', isOP);
            resolve(isOP);
          }
        };

        activeClient.on('packet', listener);

        // ใช้คำสั่ง /help แทน /gamemode เพื่อความปลอดภัย
        activeClient.queue('command_request', {
          command: '/help',
          command_origin: { type: 'player', uuid: '', request_id: 'op-check-' + Date.now(), player_id: '' },
          internal: false, version: 1
        });
      });

    } else if (activeEdition === 'java') {
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          sendLog('❌ OP Check Timeout - Default to NO OP');
          hasOPPermission = false;
          io.emit('op_status_update', false);
          resolve(false);
        }, 3500);

        // ดักจับทุกข้อความ (System/Chat/Game)
        const messageHandler = (jsonMsg) => {
          const msg = jsonMsg.toString().toLowerCase();
          
          // เช็คคำปฏิเสธสิทธิ์
          if (msg.includes('unknown') || msg.includes('no permission') || msg.includes("don't have permission")) {
            cleanup(false);
          } 
          // เช็คการเข้าถึงลิสต์คำสั่ง (ซึ่งต้องใช้ OP ในหลายเซิร์ฟเวอร์)
          else if (msg.includes('help') || msg.includes('command')) {
            cleanup(true);
          }
        };

        const cleanup = (result) => {
          clearTimeout(timeout);
          activeClient.removeListener('message', messageHandler);
          hasOPPermission = result;
          sendLog(result ? '✅ OP Status: YES!' : '❌ OP Status: NO');
          io.emit('op_status_update', result);
          resolve(result);
        };

        activeClient.on('message', messageHandler);
        // ใช้คำสั่งที่เป็นกลางที่สุด
        activeClient.chat('/help');
      });
    }
  } catch (err) {
    hasOPPermission = false;
    io.emit('op_status_update', false);
    return false;
  }
};
// ============================================
// 🎮 BEDROCK BOT (bedrock-protocol)
// ============================================
const startBedrockBot = (config) => {
  try {
    sendLog('🚀 Starting Bedrock Bot...');
    botStatus = 'Connecting...';
    io.emit('status_update', botStatus);

    const bedrockConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      offline: true,
      connectTimeout: 30000
    };

    activeClient = bedrock.createClient(bedrockConfig);

    activeClient.on('connect', () => {
      sendLog('✅ Bedrock: Connected to server');
    });

    activeClient.on('spawn', async () => {
      botStatus = 'Connected';
      botStartTime = Date.now();
      bedSummonedAtSpawn = false;
      io.emit('status_update', botStatus);
      sendLog('✅ Bedrock: Bot spawned in the world!');
      startDashboardTimer();
      // STEP 1: Check OP Status First
      const hasOP = await checkOPStatus();
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!hasOP) {
        sendLog('🚨 ALERT: Bot does NOT have OP permissions!');
        io.emit('op_alert', { hasOP: false, message: 'Bot needs OP to function properly' });
        return; // Stop here, do not continue
      }
      // Auto-AFK (prevent kick)
      startAutoAFK();
    });

    activeClient.on('set_time', (packet) => {
      gameTime = packet.time || 0;
      io.emit('time_update', {
        uptime: getBotUptime(),
        gamePeriod: getInGameTime(gameTime)
      });
    });

    activeClient.on('text', (packet) => {
      if (packet.message) {
        const messageStr = typeof packet.message === 'string' ? packet.message : JSON.stringify(packet.message);
        sendLog(`💬 Chat: ${messageStr}`);

        // Detect OP command success message (Bedrock)
        if (messageStr.includes('commands.op.message') || messageStr.includes('commands.op')) {
          sendLog('👑 OP Permission Detected! Bot received OP status!');
          hasOPPermission = true;
          io.emit('op_status_update', true);
        }
      }
    });

    activeClient.on('error', (err) => {
      botStatus = 'Error';
      sendLog(`❌ Bedrock Error: ${err.message}`);
      io.emit('status_update', botStatus);
    });

    activeClient.on('close', () => {
      botStatus = 'Disconnected';
      botStartTime = null;
      io.emit('status_update', botStatus);
      activeClient = null;
      activeEdition = null;
      sendLog('🔌 Bedrock: Disconnected from server.');
      stopDashboardTimer();
    });
  } catch (err) {
    sendLog(`❌ Bedrock StartUp Error: ${err.message}`);
    botStatus = 'Error';
    io.emit('status_update', botStatus);
  }
};

// ============================================
// 🎮 JAVA BOT (mineflayer)
// ============================================
const startJavaBot = (config) => {
  try {
    sendLog('🚀 Starting Java Bot...');
    botStatus = 'Connecting...';
    io.emit('status_update', botStatus);

    const javaConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version || '1.20.1',
      auth: 'offline'
    };

    activeClient = mineflayer.createBot(javaConfig);

    activeClient.on('login', () => {
      sendLog('✅ Java: Authenticated and logged in');
    });

    activeClient.on('spawn', async () => {
      botStatus = 'Connected';
      botStartTime = Date.now();
      bedSummonedAtSpawn = false;
      io.emit('status_update', botStatus);
      sendLog('✅ Java: Bot spawned in the world!');
      startDashboardTimer();
      // STEP 1: Check OP Status First
      const hasOP = await checkOPStatus();
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (!hasOP) {
        sendLog('🚨 ALERT: Bot does NOT have OP permissions!');
        io.emit('op_alert', { hasOP: false, message: 'Bot needs OP to function properly' });
        return; // Stop here, do not continue
      }

      // Auto-AFK
      startAutoAFK();
    });

    activeClient.on('time', () => {
    gameTime =
      activeClient.time?.timeOfDay ??
      activeClient.world?.time?.timeOfDay ??
      activeClient.world?.time?.age ??
      gameTime ??
      0;

    io.emit('time_update', {
      uptime: getBotUptime(),
      gamePeriod: getInGameTime(gameTime)
    });
  });

    activeClient.on('chat', (username, msg) => {
      if (username !== activeClient.username) {
        sendLog(`💬 ${username}: ${msg}`);
      } else {
        // Monitor bot's own chat for OP confirmation (Java)
        if (msg.includes('op') || msg.includes('Op')) {
          sendLog(`👑 OP Command Detected: ${msg}`);
          // If bot can execute command without error, it has OP
          if (!msg.includes('Unknown') && !msg.includes('error')) {
            hasOPPermission = true;
            io.emit('op_status_update', true);
            sendLog('👑 OP Permission Confirmed! Bot has OP!');
          }
        }
      }
    });

    activeClient.on('error', (err) => {
      botStatus = 'Error';
      sendLog(`❌ Java Error: ${err.message}`);
      io.emit('status_update', botStatus);
    });

    activeClient.on('end', () => {
      botStatus = 'Disconnected';
      botStartTime = null;
      io.emit('status_update', botStatus);
      activeClient = null;
      activeEdition = null;
      sendLog('🔌 Java: Disconnected from server.');
      stopDashboardTimer();
    });
  } catch (err) {
    sendLog(`❌ Java StartUp Error: ${err.message}`);
    botStatus = 'Error';
    io.emit('status_update', botStatus);
  }
};

// ============================================
// 🔧 BOT MANAGEMENT FUNCTIONS
// ============================================
const stopBot = () => {
  if (!activeClient) return;
  try {
    if (activeEdition === 'bedrock') {
      activeClient.disconnect();
    } else if (activeEdition === 'java') {
      activeClient.quit();
    }
    activeClient = null;
    activeEdition = null;
    botStatus = 'Disconnected';
    io.emit('status_update', botStatus);
    sendLog('🛑 Bot stopped by user.');
  } catch (err) {
    sendLog(`❌ Stop Error: ${err.message}`);
  }
};


const runBedrockCommand = (cmd) => {
    if (!activeClient) {
        sendLog(`⚠️ Skip Command: Bot not connected`);
        return false;
    }
  try {
    activeClient.queue('text', {
      type: 'chat',
      needs_translation: false,
      source_name: activeClient.username,
      message: cmd,
      xuid: '',
      platform_chat_id: ''
    });
  } catch (err) {
    sendLog(`❌ Command Error: ${err.message}`);
  }
};


const startAutoAFK = () => {
  const afkInterval = setInterval(() => {
    if (!activeClient || botStatus !== 'Connected') {
      clearInterval(afkInterval);
      return;
    }

    try {
      if (activeEdition === 'bedrock') {
        activeClient.queue('player_hotbar', {
          selected_slot: Math.floor(Math.random() * 8),
          window_id: 'inventory',
          select_slot: true
        });
        const randomYaw = (Math.random() * 2 - 1) * 0.1;
        const randomPitch = (Math.random() * 2 - 1) * 0.1;
        activeClient.queue('move_player', {
          runtime_id: activeClient.runtime_id,
          position: activeClient.position,
          yaw: activeClient.yaw + randomYaw,
          pitch: activeClient.pitch + randomPitch,
          head_yaw: activeClient.yaw + randomYaw,
          mode: 0,
          on_ground: true,
          tick: activeClient.tick
        });
        activeClient.queue('animate', {
          action_id: 1, // Swing arm
          runtime_entity_id: activeClient.runtime_id
        });
      } else if (activeEdition === 'java') {
        activeClient.setHeldItemSlot(Math.floor(Math.random() * 9));

        // 2. สุ่มกระโดด (Jump) นานๆ ครั้ง - ช่วยรีเซ็ต AFK ได้ดีมากใน Java
        if (Math.random() > 0.5) {
            activeClient.setControlState('jump', true);
            setTimeout(() => activeClient.setControlState('jump', false), 500);
        }

        // 3. ลดความถี่การแชท (Chat) ให้เหลือแค่ 1 ใน 3 ของรอบทำงาน
        if (Math.random() > 0.7) {
            const randomNum = Math.floor(Math.random() * 1000);
            // ใช้คำสั่งสั้นๆ ที่ไม่รบกวนระบบมาก
            activeClient.chat(`/stats`); // หรือคำสั่งอื่นที่เซิร์ฟเวอร์รองรับ
        }

        // 4. แก้ไขการหันมอง (Look) ให้ปลอดภัยขึ้น
        const currentYaw = activeClient.entity.yaw;
        const currentPitch = activeClient.entity.pitch;
        activeClient.look(currentYaw + (Math.random() * 0.4 - 0.2), currentPitch, false);
      }
    } catch (err) {
      // Silent fail for AFK
    }
  }, 120000); // Every 1 minute
};

// ============================================
// ⏱️ UTILITY FUNCTIONS
// ============================================
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
  if (timeOfDay >= 0 && timeOfDay < 12000) return '☀️ Day';
  if (timeOfDay >= 12000 && timeOfDay < 13000) return '🌅 Sunset';
  if (timeOfDay >= 13000 && timeOfDay < 23000) return '🌙 Night';
  return '🌄 Sunrise';
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


// ============================================
// 🌐 WEB ROUTES & SOCKET.IO
// ============================================
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  // Send initial data to new client
  socket.emit('status_update', botStatus);
  socket.emit('log_history', logHistory);
  socket.emit('active_edition', activeEdition);
  socket.emit('op_status_update', hasOPPermission);

  // Handle bot control commands
  socket.on('control_bot', (action, data) => {
    if (action === 'start') {
      // Reset OP status
      hasOPPermission = null;
      io.emit('op_status_update', null);

      // Disconnect old client first
      if (activeClient) {
        stopBot();
        setTimeout(() => {
          const edition = data.edition || 'bedrock';
          const config = {
            host: data.host || 'localhost',
            port: parseInt(data.port) || 19132,
            username: data.username || 'MinecraftBot'
          };

          if (edition === 'bedrock') {
            activeEdition = 'bedrock';
            startBedrockBot(config);
          } else if (edition === 'java') {
            activeEdition = 'java';
            config.version = data.version || '1.20.1';
            startJavaBot(config);
          }
          io.emit('active_edition', activeEdition);
        }, 1000);
      } else {
        const edition = data.edition || 'bedrock';
        const config = {
          host: data.host || 'localhost',
          port: parseInt(data.port) || 19132,
          username: data.username || 'MinecraftBot'
        };

        if (edition === 'bedrock') {
          activeEdition = 'bedrock';
          startBedrockBot(config);
        } else if (edition === 'java') {
          activeEdition = 'java';
          config.version = data.version || '1.20.1';
          startJavaBot(config);
        }
        io.emit('active_edition', activeEdition);
      }
    }
    if (action === 'stop') {
      stopBot();
    }
  });
});

// ============================================
// 🚀 SERVER START
// ============================================
const PORT = process.env.PORT || 5500;
server.listen(PORT, '0.0.0.0', () => {
  sendLog(`🌐 Dashboard running on port ${PORT}`);
  sendLog('✨ Minecraft Bot Dashboard v2.0 Ready!');
});

// Graceful shutdown
process.on('SIGINT', () => {
  sendLog('💤 Shutting down gracefully...');
  if (activeClient) stopBot();
  server.close(() => {
    sendLog('👋 Server closed.');
    process.exit(0);
  });
});