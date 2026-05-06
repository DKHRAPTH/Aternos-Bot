const mineflayer = require('mineflayer');

let activeClient = null;
let afkInterval = null;

const checkOPStatus = async (ctx) => {
  if (!activeClient) return false;
  try {
    ctx.sendLog('Checking OP Status...');
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ctx.sendLog('OP Check Timeout - Default to NO OP');
        ctx.setOPPermission(false);
        resolve(false);
      }, 3500);

      const messageHandler = (jsonMsg) => {
        const msg = jsonMsg.toString().toLowerCase();
        if (msg.includes('unknown') || msg.includes('no permission') || msg.includes("don't have permission")) {
          cleanup(false);
        } else if (msg.includes('help') || msg.includes('command')) {
          cleanup(true);
        }
      };

      const cleanup = (result) => {
        clearTimeout(timeout);
        activeClient.removeListener('message', messageHandler);
        ctx.setOPPermission(result);
        ctx.sendLog(result ? 'OP Status: YES' : 'OP Status: NO');
        resolve(result);
      };

      activeClient.on('message', messageHandler);
      activeClient.chat('/help');
    });
  } catch (err) {
    ctx.setOPPermission(false);
    return false;
  }
};

const startAutoAFK = () => {
  afkInterval = setInterval(() => {
    if (!activeClient) {
      clearInterval(afkInterval);
      return;
    }
    try {
      activeClient.setHeldItemSlot(Math.floor(Math.random() * 9));
      if (Math.random() > 0.5) {
        activeClient.setControlState('jump', true);
        setTimeout(() => activeClient.setControlState('jump', false), 500);
      }
      if (Math.random() > 0.7) {
        activeClient.chat(`/stats`);
      }
      const currentYaw = activeClient.entity.yaw;
      const currentPitch = activeClient.entity.pitch;
      activeClient.look(currentYaw + (Math.random() * 0.4 - 0.2), currentPitch, false);
    } catch (err) {}
  }, 45000);
};

module.exports = {
  start: (config, ctx) => {
    try {
      ctx.sendLog('Starting Java Bot...');
      ctx.updateStatus('Connecting...');
      activeClient = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version || '1.20.1',
        auth: 'offline'
      });

      activeClient.on('login', () => {
        ctx.sendLog('Java: Authenticated and logged in');
      });

      activeClient.on('spawn', async () => {
        ctx.updateStatus('Connected');
        ctx.setStartTime(Date.now());
        ctx.sendLog('Java: Bot spawned in the world!');
        ctx.startDashboardTimer();
        const hasOP = await checkOPStatus(ctx);
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!hasOP) {
          ctx.sendLog('ALERT: Bot does NOT have OP permissions!');
          ctx.emit('op_alert', { hasOP: false, message: 'Bot needs OP to function properly' });
          return;
        }
        ctx.sendLog('Changing gamemode to Creative...');
        activeClient.chat('/gamemode creative');
        startAutoAFK();
      });

      activeClient.on('time', () => {
        ctx.setGameTime(activeClient.time?.timeOfDay ?? activeClient.world?.time?.timeOfDay ?? activeClient.world?.time?.age ?? 0);
      });

      activeClient.on('chat', (username, msg) => {
        if (username !== activeClient.username) {
          ctx.sendLog(`${username}: ${msg}`);
        } else {
          if (msg.includes('op') || msg.includes('Op')) {
            ctx.sendLog(`OP Command Detected: ${msg}`);
            if (!msg.includes('Unknown') && !msg.includes('error')) {
              ctx.setOPPermission(true);
              ctx.sendLog('OP Permission Confirmed! Bot has OP!');
            }
          }
        }
      });

      activeClient.on('error', (err) => {
        ctx.sendLog(`Java Error: ${err.message}`);
        ctx.updateStatus('Error');
      });

      activeClient.on('end', () => {
        ctx.sendLog('Java: Disconnected from server.');
        activeClient = null;
        clearInterval(afkInterval);
        ctx.handleDisconnect();
      });
    } catch (err) {
      ctx.sendLog(`Java StartUp Error: ${err.message}`);
      ctx.updateStatus('Error');
    }
  },
  stop: () => {
    if (activeClient) {
      activeClient.quit();
      activeClient = null;
    }
    if (afkInterval) clearInterval(afkInterval);
  }
};