const bedrock = require('bedrock-protocol');

let activeClient = null;
let afkInterval = null;

const checkOPStatus = async (ctx) => {
  if (!activeClient) return false;
  try {
    ctx.sendLog('Checking OP Status...');
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ctx.sendLog('OP Check timed out - Assuming NO OP');
        ctx.setOPPermission(false);
        resolve(false);
      }, 3000);

      const listener = (packet) => {
        if (packet.name === 'command_output') {
          clearTimeout(timeout);
          activeClient.off('packet', listener);
          const isOP = packet.params.success_count > 0;
          ctx.setOPPermission(isOP);
          ctx.sendLog(isOP ? 'OP Status: YES' : 'OP Status: NO');
          resolve(isOP);
        }
      };

      activeClient.on('packet', listener);
      activeClient.queue('command_request', {
        command: '/help',
        command_origin: { type: 'player', uuid: '', request_id: 'op-check-' + Date.now(), player_id: '' },
        internal: false, version: 1
      });
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
        action_id: 1,
        runtime_entity_id: activeClient.runtime_id
      });
    } catch (err) {}
  }, 45000);
};

module.exports = {
  start: (config, ctx) => {
    try {
      ctx.sendLog('Starting Bedrock Bot...');
      ctx.updateStatus('Connecting...');
      activeClient = bedrock.createClient({
        host: config.host,
        port: config.port,
        username: config.username,
        offline: true,
        connectTimeout: 90000
      });

      activeClient.on('connect', () => {
        ctx.sendLog('Bedrock: Connected to server');
      });

      activeClient.on('spawn', async () => {
        ctx.updateStatus('Connected');
        ctx.setStartTime(Date.now());
        ctx.sendLog('Bedrock: Bot spawned in the world!');
        ctx.startDashboardTimer();
        const hasOP = await checkOPStatus(ctx);
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!hasOP) {
          ctx.sendLog('ALERT: Bot does NOT have OP permissions!');
          ctx.emit('op_alert', { hasOP: false, message: 'Bot needs OP to function properly' });
          return;
        }
        ctx.sendLog('Changing gamemode to Creative...');
        activeClient.queue('command_request', {
          command: '/gamemode c',
          command_origin: { type: 'player', uuid: '', request_id: 'set-gm-' + Date.now(), player_id: '' },
          internal: false, version: 1
        });
        startAutoAFK();
      });

      activeClient.on('set_time', (packet) => {
        ctx.setGameTime(packet.time || 0);
      });

      activeClient.on('text', (packet) => {
        if (packet.message) {
          const messageStr = typeof packet.message === 'string' ? packet.message : JSON.stringify(packet.message);
          ctx.sendLog(`Chat: ${messageStr}`);
          if (messageStr.includes('commands.op.message') || messageStr.includes('commands.op')) {
            ctx.sendLog('OP Permission Detected! Bot received OP status!');
            ctx.setOPPermission(true);
          }
        }
      });

      activeClient.on('error', (err) => {
        ctx.sendLog(`Bedrock Error: ${err.message}`);
        ctx.updateStatus('Error');
      });

      activeClient.on('close', () => {
        ctx.sendLog('Bedrock: Disconnected from server.');
        activeClient = null;
        clearInterval(afkInterval);
        ctx.handleDisconnect();
      });
    } catch (err) {
      ctx.sendLog(`Bedrock StartUp Error: ${err.message}`);
      ctx.updateStatus('Error');
    }
  },
  stop: () => {
    if (activeClient) {
      activeClient.disconnect();
      activeClient = null;
    }
    if (afkInterval) clearInterval(afkInterval);
  }
};