/**
 * ============================================================================
 * SUGAR RUSH - MASTER DISCORD AUTOMATION INFRASTRUCTURE
 * ============================================================================
 * * VERSION: 82.0.7 (FEATURE: AUTOMATIC WEEKLY QUOTA)
 * * ----------------------------------------------------------------------------
 * 📜 FULL COMMAND REGISTER (35 TOTAL COMMANDS):
 *
 * [1] OWNER & SYSTEM
 * • !eval [code]              : (Message) Executes raw Node.js code.
 * • /generate_codes [amt]     : Creates VIP codes for the shop database.
 * • /serverblacklist [id] [r] : Bans a specific server from using the bot.
 * • /unserverblacklist [id]   : Unbans a server (Restored Command).
 *
 * [2] MANAGEMENT & DISCIPLINE
 * • /warn [id] [reason]       : (Cooks/Mgmt) Warns user. Pre-cooking (Pending/Claimed) ONLY.
 * • /fdo [id] [reason]        : (Mgmt) Force Discipline. Pre-delivery (Ready) ONLY.
 * • /force_warn [id] [reason] : (Mgmt) Force Warn. Applied to ANY status (e.g. Delivered).
 * • /ban [uid] [days]         : Service bans a user from ordering.
 * • /unban [uid]              : Removes service ban from a user.
 * • /refund [id]              : Refunds an order & marks as refunded.
 * • /run_quota                : Manually triggers the weekly staff quota audit.
 *
 * [3] CUSTOMER - ECONOMY & VIP
 * • /balance                  : Shows your Sugar Coin wallet.
 * • /daily                    : Claims daily reward (1000 or 2000 VIP).
 * • /tip [id] [amt]           : Tips coins to staff (Splits Cook/Driver).
 * • /redeem [code]            : Activates 30-day VIP status.
 * • /premium                  : Links to the donation shop.
 *
 * [4] CUSTOMER - ORDERING
 * • /order [item]             : Standard Order (100 Sugar Coins).
 * • /super_order [item]       : Priority Order (150 Sugar Coins).
 * • /orderstatus              : Checks status of your active order(s) [Max 3].
 * • /orderinfo [id]           : Shows details (Chef, Driver, timestamps).
 * • /oinfo [id]               : Shortcut to check item/details for an order.
 * • /rate [id] [stars] [fb]   : Rates a delivered order (1-5 Stars).
 * • /review [rating] [msg]    : (Legacy) Submit a general review.
 *
 * [5] STAFF - KITCHEN (Cook Role)
 * • /claim [id]               : Assigns a pending order to you.
 * • /cook [id] [proofs...]    : Starts 3m cooking timer. Accepts up to 3 images/links.
 * • /orderlist                 : View pending queue (Priority Sorted).
 *
 * [6] STAFF - DELIVERY (Driver Role)
 * • /deliver [id]             : Pick up ready order & start delivery flow.
 * • /deliverylist             : View ready queue (Priority Sorted).
 * • /setscript [msg]          : Save custom delivery text.
 *
 * [7] STAFF - GENERAL
 * • /stats [user]             : View balance and work history.
 * • /vacation [days]          : Request quota exemption.
 * • /staff_buy                : Buy 'Double Stats' buff (15k Coins).
 *
 * [8] UTILITY
 * • /invite                   : Get bot invite link.
 * • /support                  : Get HQ server link.
 * • /rules                    : Read rules from Google Sheets.
 * * ----------------------------------------------------------------------------
 * 🍩 CORE SPECS:
 * - Economy: 100/50 (Std) | 150/75 (Super).
 * - Quota: Trainee(5), Senior(50%), Std(100%).
 * - Auto-Quota: Runs Sundays at 00:00 UTC (or manually via /run_quota).
 * - Discipline: 3/6/9 Strikes.
 * - Visuals: Super(Red), VIP(Gold), Std(Orange).
 * ============================================================================
 */

require('dotenv').config();

const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ActivityType 
} = require('discord.js');

const mongoose = require('mongoose');
const { google } = require('googleapis');
const util = require('util');

// ============================================================================
// [1] CONFIGURATION & CONSTANTS
// ============================================================================

const CONF_TOKEN = process.env.DISCORD_TOKEN;
const CONF_MONGO = process.env.MONGO_URI;
const CONF_SHEET = process.env.GOOGLE_SHEET_ID;
const CONF_OWNER = '662655499811946536';
const CONF_HQ_ID = '1454857011866112063';
const CONF_STORE = "https://donuts.sell.app/";
const CONF_SUPPORT_SERVER = "https://discord.gg/Q4DsEbJzBJ";

// ROLES
const ROLE_COOK = '1454877400729911509';
const ROLE_DELIVERY = '1454877287953469632';
const ROLE_MANAGER = '1454876343878549630';
const ROLE_QUOTA_EXEMPT = '1454936082591252534';

// QUOTA RANKS (Replace with actual IDs)
const ROLE_TRAINEE_COOK = 'REPLACE_ID';
const ROLE_TRAINEE_DELIVERY = 'REPLACE_ID';
const ROLE_SENIOR_COOK = 'REPLACE_ID';
const ROLE_SENIOR_DELIVERY = 'REPLACE_ID';

// CHANNELS
const CHAN_COOK = '1454879418999767122';
const CHAN_DELIVERY = '1454880879741767754';
const CHAN_BACKUP = '1454888266451910901';
const CHAN_QUOTA = '1454895987322519672';
const CHAN_WARNINGS = '1454881451161026637';
const CHAN_BLACKLIST = '1455092188626292852';
const CHAN_VACATION = '1454886383662665972';
const CHAN_RATINGS = '1454884136740327557';

// COLORS
const COLOR_MAIN = 0xFFA500;   // Orange (Standard)
const COLOR_VIP = 0xF1C40F;    // Gold (VIP)
const COLOR_FAIL = 0xFF0000;   // Red (Super/Error)
const COLOR_SUCCESS = 0x2ECC71; // Green

// ============================================================================
// [2] DATABASE SCHEMAS
// ============================================================================

const UserSchema = new mongoose.Schema({
    user_id: { type: String, required: true, unique: true },
    balance: { type: Number, default: 0 },
    last_daily: { type: Date, default: new Date(0) },
    cook_count_week: { type: Number, default: 0 },
    cook_count_total: { type: Number, default: 0 },
    deliver_count_week: { type: Number, default: 0 },
    deliver_count_total: { type: Number, default: 0 },
    vip_until: { type: Date, default: new Date(0) },
    is_perm_banned: { type: Boolean, default: false },
    service_ban_until: { type: Date, default: null },
    double_stats_until: { type: Date, default: new Date(0) },
    warnings: { type: Number, default: 0 }
});

const OrderSchema = new mongoose.Schema({
    order_id: String,
    user_id: String,
    guild_id: String,
    channel_id: String,
    status: { type: String, default: 'pending' }, 
    item: String,
    is_vip: { type: Boolean, default: false },
    is_super: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    chef_name: String,
    chef_id: String,
    deliverer_id: String,
    delivery_started_at: Date, 
    ready_at: Date,
    images: [String],
    backup_msg_id: String,
    kitchen_msg_id: String, 
    rating: { type: Number, default: 0 },
    feedback: { type: String, default: "" },
    rated: { type: Boolean, default: false }
});

const VIPCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    is_used: { type: Boolean, default: false }
});

const ScriptSchema = new mongoose.Schema({
    user_id: String,
    script: String
});

const BlacklistSchema = new mongoose.Schema({
    guild_id: String,
    reason: String,
    authorized_by: String
});

// NEW: Config Schema for Auto-Runs
const ConfigSchema = new mongoose.Schema({
    id: { type: String, default: 'main' },
    last_quota_run: { type: Date, default: new Date(0) }
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);
const VIPCode = mongoose.model('VIPCode', VIPCodeSchema);
const Script = mongoose.model('Script', ScriptSchema);
const ServerBlacklist = mongoose.model('ServerBlacklist', BlacklistSchema);
const SystemConfig = mongoose.model('SystemConfig', ConfigSchema);

// ============================================================================
// [3] HELPER FUNCTIONS
// ============================================================================

const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

async function fetchRules() {
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: CONF_SHEET, range: 'Rules!A1:B20' });
        const rows = res.data.values;
        if (!rows) return "Offline.";
        return rows.map(r => `🍩 **${r[0]}**\n└ ${r[1]}`).join('\n\n');
    } catch (e) { return "System Syncing..."; }
}

function createEmbed(title, description, color = COLOR_MAIN, fields = []) {
    return new EmbedBuilder()
        .setAuthor({ name: "Sugar Rush" })
        .setTitle(title)
        .setDescription(description || null)
        .setColor(color)
        .setFooter({ text: "Sugar Rush Operations" })
        .setTimestamp()
        .addFields(fields);
}

async function checkPermissions(userId) {
    if (userId === CONF_OWNER) return { isOwner: true, isManager: true, isCook: true, isDelivery: true, isStaff: true };
    try {
        const guild = client.guilds.cache.get(CONF_HQ_ID);
        const member = await guild.members.fetch(userId);
        const hasManager = member.roles.cache.has(ROLE_MANAGER);
        const hasCook = member.roles.cache.has(ROLE_COOK);
        const hasDelivery = member.roles.cache.has(ROLE_DELIVERY);
        return {
            isOwner: false,
            isManager: hasManager,
            isCook: hasCook || hasManager,
            isDelivery: hasDelivery || hasManager,
            isStaff: hasCook || hasDelivery || hasManager
        };
    } catch (err) { return { isOwner: false, isManager: false, isCook: false, isDelivery: false, isStaff: false }; }
}

async function updateOrderArchive(orderId) {
    try {
        const channel = await client.channels.fetch(CHAN_BACKUP).catch(() => null);
        const order = await Order.findOne({ order_id: orderId });
        if (!channel || !order) return;
        
        let color = COLOR_MAIN;
        if (order.is_super) color = COLOR_FAIL;
        else if (order.is_vip) color = COLOR_VIP;

        const embed = createEmbed(`Archive: #${order.order_id}`, null, color, [
            { name: 'Status', value: `\`${order.status.toUpperCase()}\``, inline: true },
            { name: 'Customer', value: `<@${order.user_id}>`, inline: true },
            { name: 'Chef', value: order.chef_name || 'Pending', inline: true },
            { name: 'Courier', value: order.deliverer_id ? `<@${order.deliverer_id}>` : 'Pending', inline: true }
        ]);
        if (order.images?.length > 0) embed.setImage(order.images[0]);
        
        if (!order.backup_msg_id) {
            const msg = await channel.send({ embeds: [embed] });
            order.backup_msg_id = msg.id;
            await order.save();
        } else {
            const msg = await channel.messages.fetch(order.backup_msg_id).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed] });
        }
    } catch (error) {}
}

async function applyWarningLogic(user) {
    user.warnings += 1;
    let punishment = "Formal Warning";
    if (user.warnings === 3) {
        user.service_ban_until = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
        punishment = "7-Day Service Ban";
    } else if (user.warnings === 6) {
        user.service_ban_until = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        punishment = "30-Day Service Ban";
    } else if (user.warnings >= 9) {
        user.is_perm_banned = true;
        punishment = "Permanent Blacklist";
    }
    await user.save();
    return punishment;
}

// --- QUOTA ENGINE (Auto & Manual) ---
async function executeQuotaRun(interaction = null) {
    if (interaction) await interaction.deferReply();
    console.log(`[VERBOSE] Executing Quota Run (${interaction ? 'Manual' : 'Auto'})`);
    
    const users = await User.find({ $or: [{ cook_count_week: { $gt: 0 } }, { deliver_count_week: { $gt: 0 } }] });
    const totalDeliveries = users.reduce((acc, u) => acc + u.deliver_count_week, 0);
    const totalDishes = users.reduce((acc, u) => acc + u.cook_count_week, 0);
    
    const activeStaffCount = Math.max(1, users.length);
    let globalQuota = Math.ceil((totalDishes + totalDeliveries) / activeStaffCount);
    if (globalQuota < 5) globalQuota = 5;
    if (globalQuota > 30) globalQuota = 30;

    const topCooks = [...users].sort((a, b) => b.cook_count_week - a.cook_count_week).slice(0, 3);
    const topCouriers = [...users].sort((a, b) => b.deliver_count_week - a.deliver_count_week).slice(0, 3);

    let failCount = 0;
    const supportGuild = interaction ? interaction.guild : client.guilds.cache.get(CONF_HQ_ID);

    for (const u of users) {
        let quotaTarget = globalQuota;
        let isExempt = false;

        try {
            if (supportGuild) {
                const member = await supportGuild.members.fetch(u.user_id);
                const roles = member.roles.cache;
                if (roles.has(ROLE_QUOTA_EXEMPT)) isExempt = true;
                else if (roles.has(ROLE_TRAINEE_COOK) || roles.has(ROLE_TRAINEE_DELIVERY)) quotaTarget = 5;
                else if (roles.has(ROLE_SENIOR_COOK) || roles.has(ROLE_SENIOR_DELIVERY)) quotaTarget = Math.ceil(globalQuota / 2);
            }
        } catch (e) {}

        const totalWork = u.cook_count_week + u.deliver_count_week;
        if (!isExempt && totalWork < quotaTarget) {
            u.warnings += 1;
            failCount++;
        }
        u.cook_count_week = 0;
        u.deliver_count_week = 0;
        await u.save();
    }

    const embed = createEmbed("📊 Weekly Quota Audit", `**Global Target:** ${globalQuota}\n**Failed:** ${failCount}`, COLOR_MAIN);
    embed.addFields(
        { name: "👨‍🍳 Top Chefs", value: topCooks.map((u, i) => `${i+1}. <@${u.user_id}> (${u.cook_count_week})`).join('\n') || "None" },
        { name: "🚴 Top Couriers", value: topCouriers.map((u, i) => `${i+1}. <@${u.user_id}> (${u.deliver_count_week})`).join('\n') || "None" }
    );
    
    // Notification
    client.channels.cache.get(CHAN_QUOTA)?.send({ content: "@here 📢 **WEEKLY AUDIT**", embeds: [embed] });
    
    // Interaction Reply (if manual)
    if (interaction) {
        return interaction.editReply({ content: "✅ Quota Run Successful.", embeds: [embed] });
    }
}

// ============================================================================
// [4] CLIENT LOGIC
// ============================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message]
});

client.once('ready', async () => {
    console.log(`[VERBOSE] [SYSTEM] Sugar Rush v82.0.7 Online.`);
    await mongoose.connect(CONF_MONGO);
    console.log(`[VERBOSE] [DATABASE] Connected to MongoDB.`);
    client.user.setPresence({ activities: [{ name: '/order | Sugar Rush', type: ActivityType.Playing }], status: 'online' });
    setInterval(runSystemLoop, 60000); // Check tasks every minute
});

// MAIN SYSTEM LOOP (Runs every 60s)
async function runSystemLoop() {
    // 1. ORDER FAILSAFE
    const limit = new Date(Date.now() - 1200000); 
    const staled = await Order.find({ status: 'ready', ready_at: { $lt: limit } });
    if (staled.length > 0) console.log(`[VERBOSE] Failsafe triggered for ${staled.length} orders.`);
    for (const o of staled) {
        try {
            const guild = client.guilds.cache.get(o.guild_id);
            const chan = guild?.channels.cache.get(o.channel_id);
            if (chan) {
                const embed = createEmbed("📦 Delivery Arrived", "Your order has been successfully delivered! Thank you for choosing Sugar Rush.", COLOR_SUCCESS);
                if (o.images?.length > 0) embed.setImage(o.images[0]);
                await chan.send({ content: `<@${o.user_id}>`, embeds: [embed] });
                o.status = 'delivered'; o.deliverer_id = 'SYSTEM_FAILSAFE'; await o.save();
                updateOrderArchive(o.order_id);
            }
        } catch (e) {}
    }

    // 2. AUTO QUOTA (Sundays @ 00:00)
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 0) {
        const config = await SystemConfig.findOne({ id: 'main' }) || new SystemConfig({ id: 'main' });
        // Run only if we haven't run it today (prevents loop spam)
        if (config.last_quota_run.toDateString() !== now.toDateString()) {
            await executeQuotaRun(null); // Auto run
            config.last_quota_run = now;
            await config.save();
        }
    }
}

// ============================================================================
// [5] INTERACTION ROUTER
// ============================================================================

client.on('interactionCreate', async (interaction) => {
    
    // --- BUTTON HANDLERS ---
    if (interaction.isButton()) {
        const [action, ...args] = interaction.customId.split('_');
        console.log(`[VERBOSE] Button Click: ${action} by ${interaction.user.tag} (ID: ${interaction.user.id})`);

        // VACATION LOGIC
        if (action === 'approve' || action === 'deny') {
            const perms = await checkPermissions(interaction.user.id);
            if (!perms.isManager) return interaction.reply({ content: "Unauthorized.", ephemeral: true });
            
            const uid = args[0];
            const days = args[1];

            if (action === 'approve') {
                const guild = client.guilds.cache.get(CONF_HQ_ID);
                const mem = await guild.members.fetch(uid).catch(() => null);
                if (mem) await mem.roles.add(ROLE_QUOTA_EXEMPT);
                await interaction.message.edit({ embeds: [createEmbed("Vacation Approved", `<@${uid}> - ${days} Days`, COLOR_SUCCESS)], components: [] });
            } else {
                await interaction.message.edit({ embeds: [createEmbed("Vacation Denied", `<@${uid}>`, COLOR_FAIL)], components: [] });
            }
            return;
        }

        // DELIVERY COMPLETION
        if (action === 'complete') {
            const oid = args[0];
            const order = await Order.findOne({ order_id: oid });
            
            if (!order) return interaction.reply({ content: "❌ Order not found.", ephemeral: true });
            if (order.status === 'delivered') return interaction.reply({ content: "❌ Already completed.", ephemeral: true });
            if (order.deliverer_id !== interaction.user.id) return interaction.reply({ content: "❌ Not your order.", ephemeral: true });

            const timeLimit = 5 * 60 * 1000;
            const elapsed = Date.now() - order.delivery_started_at.getTime();
            
            if (elapsed > timeLimit) {
                order.status = 'ready';
                order.deliverer_id = null;
                order.delivery_started_at = null;
                await order.save();
                console.log(`[VERBOSE] Delivery TIMEOUT for Order #${oid}`);
                return interaction.reply({ content: "❌ **TIMEOUT:** You took >5 mins. Order returned to queue. No pay.", ephemeral: true });
            }

            try {
                const targetGuild = client.guilds.cache.get(order.guild_id);
                if (!targetGuild) return interaction.reply({ content: "❌ Bot is not in that server.", ephemeral: true });
                await targetGuild.members.fetch(interaction.user.id); 
            } catch (e) {
                order.status = 'ready';
                order.deliverer_id = null;
                order.delivery_started_at = null;
                await order.save();
                console.log(`[VERBOSE] Delivery Failed (Not in Server) for Order #${oid}`);
                return interaction.reply({ content: "❌ **LEFT SERVER:** You must be in the server. Order returned to queue. No pay.", ephemeral: true });
            }

            order.status = 'delivered';
            await order.save();

            const staff = await User.findOne({ user_id: interaction.user.id }) || new User({ user_id: interaction.user.id });
            staff.balance += 30;
            staff.deliver_count_total += 1;
            staff.deliver_count_week += 1;
            await staff.save();

            updateOrderArchive(oid);
            console.log(`[VERBOSE] Delivery Complete Order #${oid} by ${interaction.user.tag}`);
            await interaction.update({ components: [] });
            await interaction.followUp({ embeds: [createEmbed("✅ Delivery Confirmed", `Payment of **30 Sugar Coins** added to vault.`, COLOR_SUCCESS)], ephemeral: true });
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;
    console.log(`[VERBOSE] Command /${commandName} used by ${interaction.user.tag} (${interaction.user.id})`);

    const perms = await checkPermissions(interaction.user.id);
    const userData = await User.findOne({ user_id: interaction.user.id }) || new User({ user_id: interaction.user.id });

    // Deferral Logic
    const publicCmds = ['help', 'order', 'super_order', 'orderstatus', 'orderinfo', 'oinfo', 'daily', 'balance', 'premium', 'redeem', 'review', 'tip', 'invite', 'support', 'rules', 'rate'];
    const noDefer = ['deliver', 'run_quota']; 
    if (!noDefer.includes(commandName)) await interaction.deferReply({ ephemeral: !publicCmds.includes(commandName) });

    // Ban Gate
    if (userData.is_perm_banned || (userData.service_ban_until > Date.now())) {
        const msg = `❌ **Banned.** Appeal: ${CONF_SUPPORT_SERVER}`;
        if (!noDefer.includes(commandName)) return interaction.editReply(msg);
        return interaction.reply({ content: msg, ephemeral: true });
    }

    // --- OWNER COMMANDS ---
    if (commandName === 'generate_codes') {
        if (!perms.isOwner) return interaction.editReply("❌ Owner Only.");
        const amt = options.getInteger('amount');
        const codes = [];
        for (let i = 0; i < amt; i++) {
            const c = `VIP-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            await new VIPCode({ code: c }).save();
            codes.push(c);
        }
        await interaction.user.send({ embeds: [createEmbed("Keys", codes.join('\n'), COLOR_SUCCESS)] });
        return interaction.editReply("✅ Generated.");
    }

    if (commandName === 'serverblacklist') {
        if (!perms.isOwner) return interaction.editReply("❌ Owner Only.");
        await new ServerBlacklist({ guild_id: options.getString('id'), reason: options.getString('reason'), authorized_by: interaction.user.id }).save();
        return interaction.editReply("✅ Server Blacklisted.");
    }

    if (commandName === 'unserverblacklist') {
        if (!perms.isOwner) return interaction.editReply("❌ Owner Only.");
        await ServerBlacklist.deleteOne({ guild_id: options.getString('id') });
        return interaction.editReply("✅ Server Un-Blacklisted.");
    }

    // --- DISCIPLINARY TRIAD ---
    if (['warn', 'fdo', 'force_warn'].includes(commandName)) {
        const isFdo = commandName === 'fdo';
        const isForce = commandName === 'force_warn';
        
        if (!perms.isManager && !(commandName === 'warn' && perms.isCook)) return interaction.editReply("❌ Permission Denied.");
        
        const oid = options.getString('id');
        const reason = options.getString('reason');
        const order = await Order.findOne({ order_id: oid });

        if (!order) return interaction.editReply("❌ Invalid Order.");
        if (commandName === 'warn' && !['pending', 'claimed'].includes(order.status)) return interaction.editReply("❌ Pending/Claimed only.");
        if (isFdo && order.status !== 'ready') return interaction.editReply("❌ Ready orders only.");
        
        const target = await User.findOne({ user_id: order.user_id }) || new User({ user_id: order.user_id });
        const pen = await applyWarningLogic(target);

        if (commandName === 'warn') order.status = 'cancelled_warn';
        if (isFdo) order.status = 'cancelled_fdo';
        if (!isForce) await order.save();

        client.channels.cache.get(CHAN_WARNINGS)?.send({ embeds: [createEmbed("⚠️ Discipline Issued", `**Cmd:** /${commandName}\n**User:** <@${order.user_id}>\n**Penalty:** ${pen}`, COLOR_FAIL)] });
        try {
            const u = await client.users.fetch(order.user_id);
            await u.send({ embeds: [createEmbed("⚠️ Violation Notice", `**Reason:** ${reason}\n**Penalty:** ${pen}\n**Appeal:** ${CONF_SUPPORT_SERVER}`, COLOR_FAIL)] });
        } catch (e) {}

        return interaction.editReply(`✅ Executed. Penalty: **${pen}**`);
    }

    // --- MANAGEMENT ---
    if (commandName === 'run_quota') {
        if (!perms.isManager) return interaction.reply({ content: "❌ Management Only.", ephemeral: true });
        return executeQuotaRun(interaction);
    }

    if (commandName === 'ban' || commandName === 'unban' || commandName === 'refund') {
        if (!perms.isManager) return interaction.editReply("❌ Management Only.");
        if (commandName === 'ban') {
            const u = await User.findOne({ user_id: options.getString('uid') }) || new User({ user_id: options.getString('uid') });
            u.service_ban_until = new Date(Date.now() + (options.getInteger('days') * 86400000));
            await u.save();
            return interaction.editReply("✅ Banned.");
        }
        if (commandName === 'unban') {
            const u = await User.findOne({ user_id: options.getString('uid') });
            if (u) { u.service_ban_until = null; u.is_perm_banned = false; u.warnings = 0; await u.save(); }
            return interaction.editReply("✅ Unbanned.");
        }
        if (commandName === 'refund') {
            const o = await Order.findOne({ order_id: options.getString('id') });
            if (!o) return interaction.editReply("❌ Invalid.");
            const u = await User.findOne({ user_id: o.user_id });
            const cost = o.is_super ? 150 : (o.is_vip ? 50 : 100);
            u.balance += cost; o.status = 'refunded';
            await u.save(); await o.save();
            return interaction.editReply("✅ Refunded.");
        }
    }

    // --- CONSUMER ---
    if (commandName === 'balance') return interaction.editReply({ embeds: [createEmbed("💰 Vault", `Balance: **${userData.balance} Sugar Coins**`)] });
    
    if (commandName === 'orderstatus') {
        // CHANGED: ADDED MULTI-ORDER DISPLAY
        const activeOrders = await Order.find({ user_id: interaction.user.id, status: { $in: ['pending', 'claimed', 'cooking', 'ready'] } });
        if (!activeOrders.length) return interaction.editReply("❌ No active orders.");
        const statusList = activeOrders.map(o => `• **ID:** \`${o.order_id}\` | **Status:** ${o.status.toUpperCase()} | **Item:** ${o.item}`).join('\n');
        return interaction.editReply({ embeds: [createEmbed("🍩 Your Orders", statusList)] });
    }

    if (commandName === 'orderinfo' || commandName === 'oinfo') {
        const o = await Order.findOne({ order_id: options.getString('id') });
        if (!o) return interaction.editReply("❌ Not Found.");
        let col = COLOR_MAIN; let tier = "Standard";
        if (o.is_super) { col = COLOR_FAIL; tier = "🚀 Super"; } else if (o.is_vip) { col = COLOR_VIP; tier = "👑 VIP"; }
        const emb = createEmbed("🧾 Details", `ID: \`${o.order_id}\``, col, [
            { name: "Item", value: o.item, inline: true }, { name: "Status", value: o.status.toUpperCase(), inline: true },
            { name: "Tier", value: tier, inline: true }, { name: "Customer", value: `<@${o.user_id}>`, inline: true },
            { name: "Chef", value: o.chef_name || "Pending", inline: true }, { name: "Courier", value: o.deliverer_id ? `<@${o.deliverer_id}>` : "Pending", inline: true }
        ]);
        if (o.images?.length > 0) emb.setImage(o.images[0]);
        return interaction.editReply({ embeds: [emb] });
    }

    if (commandName === 'review') {
        client.channels.cache.get(CHAN_RATINGS)?.send({ embeds: [createEmbed("⭐ New Review", `**User:** <@${interaction.user.id}>\n**Rating:** ${options.getInteger('rating')}/5\n**Comment:** ${options.getString('comment')}`)] });
        return interaction.editReply("✅ Review Submitted.");
    }

    if (commandName === 'rate') {
        const oid = options.getString('order_id'); 
        const stars = options.getInteger('stars');
        const fb = options.getString('feedback');
        const order = await Order.findOne({ order_id: oid });

        if (!order) return interaction.editReply("❌ Order not found.");
        if (order.user_id !== interaction.user.id) return interaction.editReply("❌ Not your order.");
        if (order.rated) return interaction.editReply("❌ Already rated.");
        if (order.status !== 'delivered') return interaction.editReply("❌ Wait for delivery.");

        order.rating = stars;
        order.feedback = fb;
        order.rated = true;
        await order.save();

        const starStr = '⭐'.repeat(stars);
        const embed = createEmbed(`🌟 Order #${oid} Rated`, `**Score:** ${starStr} (${stars}/5)\n**Feedback:** "${fb}"`, COLOR_MAIN, [
             { name: "Chef", value: order.chef_id ? `<@${order.chef_id}>` : "None", inline: true },
             { name: "Courier", value: order.deliverer_id === 'SYSTEM_FAILSAFE' ? "🤖 Auto-Bot" : `<@${order.deliverer_id}>`, inline: true }
        ]);

        client.channels.cache.get(CHAN_RATINGS)?.send({ embeds: [embed] });
        try { if(order.chef_id) (await client.users.fetch(order.chef_id)).send(`🌟 **You got a ${stars}★ review!** Order #${oid}: "${fb}"`); } catch(e){}
        try { if(order.deliverer_id && order.deliverer_id !== 'SYSTEM_FAILSAFE') (await client.users.fetch(order.deliverer_id)).send(`🌟 **You got a ${stars}★ review!** Order #${oid}: "${fb}"`); } catch(e){}
        return interaction.editReply("✅ Rating saved!");
    }

    if (commandName === 'invite') {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=117761&scope=bot%20applications.commands`;
        return interaction.editReply({ embeds: [createEmbed("🤖 Invite", `**[Click to Invite](${url})**`, COLOR_MAIN, [{name:"Perms", value:"Create Invite, Read/Send/Embed"}])] });
    }

    if (commandName === 'premium') {
        return interaction.editReply({ embeds: [createEmbed("💎 Premium", `**[Premium Shop](${CONF_STORE})**`, COLOR_MAIN, [{name:"Perks", value:"50% Off Orders, 2x Daily Sugar Coins"}])] });
    }

    if (commandName === 'support') return interaction.editReply(`🍩 HQ: ${CONF_SUPPORT_SERVER}`);
    if (commandName === 'rules') return interaction.editReply({ embeds: [createEmbed("📖 Rules", await fetchRules())] });
    
    if (commandName === 'tip') {
        const amt = options.getInteger('amount');
        const oid = options.getString('order_id');
        if (userData.balance < amt) return interaction.editReply("❌ Insufficient Sugar Coins.");
        
        const order = await Order.findOne({ order_id: oid });
        if (!order) return interaction.editReply("❌ Order ID not found.");
        if (order.user_id !== interaction.user.id) return interaction.editReply("❌ Not your order.");
        if (order.status !== 'delivered') return interaction.editReply("❌ Order must be delivered first.");

        userData.balance -= amt; 
        await userData.save();
        let msg = "";

        if (order.deliverer_id === 'SYSTEM_FAILSAFE' || !order.deliverer_id) {
            if (order.chef_id) {
                const chef = await User.findOne({ user_id: order.chef_id }) || new User({ user_id: order.chef_id });
                chef.balance += amt;
                await chef.save();
                msg = `✅ **${amt} Sugar Coins** sent to Chef <@${order.chef_id}> (Auto-Delivery).`;
            } else {
                msg = `✅ **${amt} Sugar Coins** burned (No staff found).`;
            }
        } else {
            const split = Math.floor(amt / 2);
            const remainder = amt % 2; 
            
            if (order.chef_id) {
                const chef = await User.findOne({ user_id: order.chef_id }) || new User({ user_id: order.chef_id });
                chef.balance += (split + remainder);
                await chef.save();
            }
            
            const driver = await User.findOne({ user_id: order.deliverer_id }) || new User({ user_id: order.deliverer_id });
            driver.balance += split;
            await driver.save();
            msg = `✅ Tip Split! Chef <@${order.chef_id}> got **${split + remainder}**, Driver <@${order.deliverer_id}> got **${split}**.`;
        }
        return interaction.editReply(msg);
    }

    if (commandName === 'order' || commandName === 'super_order') {
        const isVip = userData.vip_until > Date.now();
        const isSuper = commandName === 'super_order';
        let cost = isSuper ? 150 : 100;
        if (isVip) cost = Math.ceil(cost * 0.5); 
        
        if (userData.balance < cost) return interaction.editReply(`❌ Need ${cost} Sugar Coins.`);

        const activeCount = await Order.countDocuments({ user_id: interaction.user.id, status: { $in: ['pending', 'claimed', 'cooking', 'ready'] } });
        if (activeCount >= 3) return interaction.editReply("❌ limit reached: You can only have 3 active orders at a time.");

        const oid = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        let kitchenMsgId = null;
        let title = "🍩 New Order", col = COLOR_MAIN, content = null, recTitle = "✅ Order Authorized";
        if (isSuper) { title = "🚀 SUPER ORDER"; col = COLOR_FAIL; content = "@here 🚀 **PRIORITY**"; recTitle = "🚀 SUPER ORDER CONFIRMED"; }
        else if (isVip) { title = "👑 VIP Order"; col = COLOR_VIP; recTitle = "👑 VIP Order Authorized"; }

        const cookChan = client.channels.cache.get(CHAN_COOK);
        if (cookChan) {
            const msg = await cookChan.send({ content: content, embeds: [createEmbed(title, `ID: ${oid}\nItem: ${options.getString('item')}`, col)] });
            kitchenMsgId = msg.id;
        }

        await new Order({ order_id: oid, user_id: interaction.user.id, guild_id: interaction.guildId, channel_id: interaction.channelId, item: options.getString('item'), is_vip: isVip, is_super: isSuper, kitchen_msg_id: kitchenMsgId }).save();
        userData.balance -= cost; await userData.save();
        
        updateOrderArchive(oid);
        console.log(`[VERBOSE] Order #${oid} Created by ${interaction.user.tag}`);
        return interaction.editReply({ embeds: [createEmbed(recTitle, `Reference ID: \`${oid}\``, col)] });
    }

    if (commandName === 'redeem') {
        const code = await VIPCode.findOne({ code: options.getString('code'), is_used: false });
        if (!code) return interaction.editReply("❌ Invalid.");
        const now = new Date();
        const add = 30 * 86400000;
        userData.vip_until = new Date((userData.vip_until > now ? userData.vip_until.getTime() : now.getTime()) + add);
        code.is_used = true; await userData.save(); await code.save();
        return interaction.editReply(`✅ VIP Extended: ${userData.vip_until.toDateString()}`);
    }

    if (commandName === 'daily') {
        if (Date.now() - userData.last_daily < 86400000) return interaction.editReply("❌ Cooldown.");
        const pay = userData.vip_until > Date.now() ? 2000 : 1000;
        userData.balance += pay; userData.last_daily = Date.now(); await userData.save();
        return interaction.editReply(`💰 +${pay} Sugar Coins.`);
    }

    // --- STAFF: KITCHEN ---
    if (commandName === 'claim') {
        if (!perms.isCook) return interaction.editReply("❌ Cooks Only.");
        const o = await Order.findOne({ order_id: options.getString('id'), status: 'pending' });
        if (!o) return interaction.editReply("❌ Invalid.");
        o.status = 'claimed'; o.chef_id = interaction.user.id; o.chef_name = interaction.user.username; await o.save();
        
        // UPDATE KITCHEN MESSAGE TO "CLAIMED"
        if (o.kitchen_msg_id) {
            try {
                const chan = client.channels.cache.get(CHAN_COOK);
                const msg = await chan.messages.fetch(o.kitchen_msg_id);
                const oldEmbed = msg.embeds[0];
                const newEmbed = new EmbedBuilder(oldEmbed.data)
                    .setTitle(`👨‍🍳 CLAIMED: ${oldEmbed.title}`) 
                    .addFields({ name: 'Chef', value: `<@${interaction.user.id}>` })
                    .setColor(COLOR_SUCCESS); 
                await msg.edit({ content: null, embeds: [newEmbed] });
            } catch (e) {}
        }

        updateOrderArchive(o.order_id);
        console.log(`[VERBOSE] Order #${o.order_id} Claimed by Chef ${interaction.user.tag}`);
        return interaction.editReply(`👨‍🍳 Claimed: ${o.order_id}`);
    }

    if (commandName === 'orderlist') {
        if (!perms.isCook) return interaction.editReply("❌ Cooks Only.");
        const orders = await Order.find({ status: 'pending' });
        if (!orders.length) return interaction.editReply("✅ No pending orders.");
        
        orders.sort((a, b) => {
            const scoreA = (a.is_super ? 2 : 0) + (a.is_vip ? 1 : 0);
            const scoreB = (b.is_super ? 2 : 0) + (b.is_vip ? 1 : 0);
            return scoreA !== scoreB ? scoreB - scoreA : a.created_at - b.created_at;
        });

        const list = orders.slice(0, 20).map((o, i) => {
            let icon = "🍩"; if (o.is_super) icon = "🚀"; else if (o.is_vip) icon = "👑";
            return `\`${i+1}.\` ${icon} **${o.item}** (ID: \`${o.order_id}\`)`;
        }).join('\n');
        return interaction.editReply({ embeds: [createEmbed("👨‍🍳 Kitchen Queue", list)] });
    }

    if (commandName === 'cook') {
        if (!perms.isCook) return interaction.editReply("❌ Cooks Only.");
        const o = await Order.findOne({ order_id: options.getString('id'), status: 'claimed', chef_id: interaction.user.id });
        if (!o) return interaction.editReply("❌ Not yours.");
        
        o.status = 'cooking'; 
        
        const proofs = [];
        if(options.getAttachment('image')) proofs.push(options.getAttachment('image').url);
        if(options.getString('link')) proofs.push(options.getString('link'));
        if(options.getAttachment('image2')) proofs.push(options.getAttachment('image2').url);
        if(options.getString('link2')) proofs.push(options.getString('link2'));
        if(options.getAttachment('image3')) proofs.push(options.getAttachment('image3').url);
        if(options.getString('link3')) proofs.push(options.getString('link3'));
        
        o.images = proofs.slice(0, 3);
        await o.save();
        
        updateOrderArchive(o.order_id);
        interaction.editReply("♨️ Cooking (3m)...");
        console.log(`[VERBOSE] Chef ${interaction.user.tag} started cooking #${o.order_id}`);
        setTimeout(async () => {
            const check = await Order.findOne({ order_id: o.order_id });
            if (check && check.status === 'cooking') {
                check.status = 'ready'; check.ready_at = new Date(); await check.save();
                userData.balance += 20; userData.cook_count_total++; await userData.save();
                updateOrderArchive(check.order_id);
                client.channels.cache.get(CHAN_DELIVERY)?.send({ embeds: [createEmbed("🥡 Ready for Pickup", `**ID:** ${check.order_id}\n**Item:** ${check.item}\n**Customer:** <@${check.user_id}>`, COLOR_MAIN)] });
                console.log(`[VERBOSE] Order #${o.order_id} is READY.`);
            }
        }, 180000);
        return;
    }

    if (commandName === 'deliverylist') {
        if (!perms.isDelivery) return interaction.editReply("❌ Delivery Only.");
        const orders = await Order.find({ status: 'ready' });
        if (!orders.length) return interaction.editReply("✅ No orders ready.");

        orders.sort((a, b) => {
            const scoreA = (a.is_super ? 2 : 0) + (a.is_vip ? 1 : 0);
            const scoreB = (b.is_super ? 2 : 0) + (b.is_vip ? 1 : 0);
            return scoreA !== scoreB ? scoreB - scoreA : a.created_at - b.created_at;
        });

        const list = orders.slice(0, 20).map((o, i) => {
            let icon = "📦"; if (o.is_super) icon = "🚀"; else if (o.is_vip) icon = "👑";
            return `\`${i+1}.\` ${icon} **${o.item}** (ID: \`${o.order_id}\`) • <@${o.user_id}>`;
        }).join('\n');
        return interaction.editReply({ embeds: [createEmbed("🚴 Dispatch Queue", list)] });
    }

    if (commandName === 'deliver') {
        if (!perms.isDelivery) return interaction.reply({ content: "❌ Delivery Only.", ephemeral: true });
        const o = await Order.findOne({ order_id: options.getString('id'), status: 'ready' });
        if (!o) return interaction.reply({ content: "❌ Not Ready.", ephemeral: true });
        
        const guild = client.guilds.cache.get(o.guild_id);
        const channel = guild?.channels.cache.get(o.channel_id);
        if (!guild || !channel) return interaction.reply({ content: "❌ Destination Lost.", ephemeral: true });

        o.status = 'delivering'; 
        o.deliverer_id = interaction.user.id; 
        o.delivery_started_at = new Date();
        await o.save();

        const script = await Script.findOne({ user_id: interaction.user.id });
        const cust = await client.users.fetch(o.user_id);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`complete_${o.order_id}`).setLabel('✅ Confirm Delivery').setStyle(ButtonStyle.Success)
        );

        let courierInServer = false;
        try { await guild.members.fetch(interaction.user.id); courierInServer = true; } catch (e) {}

        const baseMsg = `**Destination:** ${guild.name}\n**Customer:** <@${cust.id}>\n\n**Script:**\n\`\`\`${script?.script || "Enjoy!"}\`\`\``;

        if (courierInServer) {
            const jump = `https://discord.com/channels/${guild.id}/${channel.id}`;
            const dm = createEmbed("🚴 Dispatch (Manual)", `${baseMsg}\n\n🔗 [Jump to Channel](${jump})\n\n**Instructions:**\n1. Jump to channel.\n2. Paste Script.\n3. Click button below to get paid.`, COLOR_MAIN);
            if (o.images?.length > 0) dm.setImage(o.images[0]);
            
            await interaction.user.send({ embeds: [dm], components: [row] });
            console.log(`[VERBOSE] Manual Dispatch initiated for Order #${o.order_id} by ${interaction.user.tag}`);
            return interaction.reply({ content: "📫 Briefing Sent. Check DM.", ephemeral: true });
        } 
        
        try {
            const invite = await channel.createInvite({ maxAge: 1800, maxUses: 1 });
            const dm = createEmbed("🚴 Dispatch (Invite)", `${baseMsg}\n\n🔗 **Invite:** ${invite.url}\n\n**Instructions:**\n1. Join Server.\n2. Paste Script.\n3. Click button below to get paid.`, COLOR_MAIN);
            if (o.images?.length > 0) dm.setImage(o.images[0]);

            await interaction.user.send({ embeds: [dm], components: [row] });
            console.log(`[VERBOSE] Invite Dispatch initiated for Order #${o.order_id} by ${interaction.user.tag}`);
            return interaction.reply({ content: "📫 Briefing Sent. Check DM.", ephemeral: true });

        } catch (e) {
            await interaction.deferReply({ ephemeral: true });
            
            const embed = createEmbed("📦 Delivery Arrived", script?.script || "Your order has been successfully delivered! Enjoy your meal.", COLOR_MAIN).setImage(o.images[0]);
            
            await channel.send({ content: `<@${o.user_id}>`, embeds: [embed] });
            
            o.status = 'delivered'; await o.save();
            userData.balance += 30; userData.deliver_count_total++; await userData.save();
            updateOrderArchive(o.order_id);
            console.log(`[VERBOSE] Auto-Delivery (Invite Fail) for Order #${o.order_id}`);
            return interaction.editReply("⚠️ Invite Failed (Perms). Auto-Delivered.");
        }
    }

    if (commandName === 'setscript') {
        if (!perms.isDelivery) return interaction.editReply("❌ Delivery Only.");
        await Script.findOneAndUpdate({ user_id: interaction.user.id }, { script: options.getString('message') }, { upsert: true });
        return interaction.editReply("✅ Saved.");
    }

    if (commandName === 'stats') {
        const target = options.getUser('user') || interaction.user;
        const tData = await User.findOne({ user_id: target.id });
        if (!tData) return interaction.editReply("❌ No Data.");
        return interaction.editReply({ embeds: [createEmbed(`Audit: ${target.username}`, `💰 **${tData.balance} Sugar Coins**\n👨‍🍳 ${tData.cook_count_total}\n🚴 ${tData.deliver_count_total}`)] });
    }

    if (commandName === 'vacation') {
        const days = options.getInteger('duration');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_${interaction.user.id}_${days}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        client.channels.cache.get(CHAN_VACATION)?.send({ embeds: [createEmbed("Vacation Request", `<@${interaction.user.id}> for ${days} days.`)], components: [row] });
        return interaction.editReply("✅ Request Sent.");
    }

    if (commandName === 'staff_buy') {
        if (userData.balance < 15000) return interaction.editReply("❌ Need 15k Sugar Coins.");
        userData.balance -= 15000;
        userData.double_stats_until = new Date(Date.now() + (30 * 86400000));
        await userData.save();
        return interaction.editReply("✅ Double Stats Active (30 Days).");
    }
});

client.on('messageCreate', async (m) => {
    if (m.author.bot || !m.content.startsWith("!eval") || m.author.id !== CONF_OWNER) return;
    try { m.channel.send(`\`\`\`js\n${util.inspect(await eval(m.content.slice(5)), {depth:0})}\n\`\`\``); } catch (e) { m.channel.send(`${e}`); }
});

client.login(CONF_TOKEN);
