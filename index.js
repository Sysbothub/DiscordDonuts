/**
 * ============================================================================
 * SUGAR RUSH - MASTER DISCORD AUTOMATION INFRASTRUCTURE
 * ============================================================================
 * * VERSION: 82.6.35 (FIXED PLACEHOLDER LOGIC)
 * * ----------------------------------------------------------------------------
 * 📜 FULL COMMAND REGISTER (38 TOTAL COMMANDS):
 * [MAINTAINED EXACTLY AS ORIGINAL]
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
    ActivityType,
    ComponentType 
} = require('discord.js');

const mongoose = require('mongoose');
const https = require('https'); // USING NATIVE HTTPS (No External Library needed)

// ============================================================================
// [1] CONFIGURATION & CONSTANTS
// ============================================================================

const CONF_TOKEN = process.env.DISCORD_TOKEN;
const CONF_MONGO = process.env.MONGO_URI;
const CONF_TRELLO_LIST = process.env.TRELLO_LIST_ID;
const CONF_TRELLO_KEY = process.env.TRELLO_KEY;
const CONF_TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const CONF_TOPGG_TOKEN = process.env.TOPGG_TOKEN;

const CONF_OWNER = '662655499811946536';
const CONF_HQ_ID = '1454857011866112063';
const CONF_STORE = "https://patreon.com/Sugar_Rush_Services";
const CONF_SUPPORT_SERVER = "https://discord.gg/Q4DsEbJzBJ";

// ROLES
const ROLE_COOK = '1454877400729911509';
const ROLE_DELIVERY = '1454877287953469632';
const ROLE_MANAGER = '1454876343878549630';
const ROLE_QUOTA_EXEMPT = '1454936082591252534';
const ROLE_PR_LEAD = process.env.ROLE_PR_LEAD; 

// QUOTA RANKS
const ROLE_TRAINEE_COOK = '1454877490156671090';
const ROLE_TRAINEE_DELIVERY = '1454877542258577458';
const ROLE_SENIOR_COOK = '1455749817853542431';
const ROLE_SENIOR_DELIVERY = '1455749793685962762';

// CHANNELS
const CHAN_COOK = '1454879418999767122';
const CHAN_DELIVERY = '1454880879741767754';
const CHAN_BACKUP = '1454888266451910901';
const CHAN_QUOTA = '1454895987322519672';
const CHAN_WARNINGS = '1454881451161026637';
const CHAN_RATINGS = '1454884136740327557';
const CHAN_VACATION = '1454886383662665972';

// COLORS
const COLOR_MAIN = 0xFFA500;    
const COLOR_VIP = 0xF1C40F;     
const COLOR_FAIL = 0xFF0000;    
const COLOR_SUCCESS = 0x2ECC71; 
const COLOR_PARTNER = 0xFF69B4; 

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
    last_overflow_bypass: { type: Date, default: new Date(0) },
    is_perm_banned: { type: Boolean, default: false },
    service_ban_until: { type: Date, default: null },
    double_stats_until: { type: Date, default: new Date(0) },
    warnings: { type: Number, default: 0 }
});

const OrderSchema = new mongoose.Schema({
    order_id: String,
    user_id: String,
    guild_id: String,
    guild_name: String,   
    channel_id: String,
    channel_name: String, 
    status: { type: String, default: 'pending' }, 
    item: String,
    is_vip: { type: Boolean, default: false },
    is_super: { type: Boolean, default: false },
    is_partner_order: { type: Boolean, default: false }, 
    created_at: { type: Date, default: Date.now },
    chef_name: String,
    chef_id: String,
    deliverer_id: String,
    delivery_started_at: Date, 
    ready_at: Date,
    images: [String],
    kitchen_msg_id: String,
    rating: { type: Number, default: 0 },
    feedback: { type: String, default: "" },
    rated: { type: Boolean, default: false },
    backup_msg_id: String
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);
const VIPCode = mongoose.model('VIPCode', new mongoose.Schema({ code: { type: String, unique: true }, is_used: { type: Boolean, default: false } }));
const Script = mongoose.model('Script', new mongoose.Schema({ user_id: String, script: String }));
const ServerBlacklist = mongoose.model('ServerBlacklist', new mongoose.Schema({ guild_id: String, reason: String, authorized_by: String }));
const PartnerServer = mongoose.model('PartnerServer', new mongoose.Schema({ guild_id: String, added_by: String, date: { type: Date, default: Date.now } })); 
const SystemConfig = mongoose.model('SystemConfig', new mongoose.Schema({ id: { type: String, default: 'main' }, last_quota_run: { type: Date, default: new Date(0) } }));

// ============================================================================
// [3] HELPER FUNCTIONS
// ============================================================================

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

// FIX: Native HTTPS Request to bypass Library Errors
async function fetchRules() {
    return new Promise((resolve) => {
        if (!CONF_TRELLO_LIST || !CONF_TRELLO_KEY || !CONF_TRELLO_TOKEN) {
            console.error("❌ MISSING TRELLO ENV VARS");
            return resolve("⚠️ Rules configuration error. Check console.");
        }

        const url = `https://api.trello.com/1/lists/${CONF_TRELLO_LIST}/cards?key=${CONF_TRELLO_KEY}&token=${CONF_TRELLO_TOKEN}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const cards = JSON.parse(data);
                    if (!Array.isArray(cards)) return resolve("⚠️ Error reading Trello (Invalid Response).");
                    if (cards.length === 0) return resolve("No rules found in Trello list.");
                    
                    const formatted = cards.map(card => `🍩 **${card.name}**\n└ ${card.desc || "No description."}`).join('\n\n');
                    resolve(formatted);
                } catch (e) {
                    console.error(e);
                    resolve("⚠️ Error parsing Trello data.");
                }
            });
        }).on('error', (err) => {
            console.error(err);
            resolve("⚠️ Rules Offline (Connection Error).");
        });
    });
}

function postTopGGStats(serverCount, botId) {
    if (!CONF_TOPGG_TOKEN) return;
    const data = JSON.stringify({ server_count: serverCount });
    const options = {
        hostname: 'top.gg',
        path: `/api/bots/${botId}/stats`,
        method: 'POST',
        headers: {
            'Authorization': CONF_TOPGG_TOKEN,
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    const req = https.request(options, (res) => {});
    req.on('error', (error) => { console.error('[Top.gg] Error:', error); });
    req.write(data);
    req.end();
}

async function applyWarningLogic(user, reason) {
    user.warnings += 1;
    let punishment = "Formal Warning";
    if (user.warnings === 3) {
        user.service_ban_until = new Date(Date.now() + 7 * 86400000);
        punishment = "7-Day Service Ban";
    } else if (user.warnings === 6) {
        user.service_ban_until = new Date(Date.now() + 30 * 86400000);
        punishment = "30-Day Service Ban";
    } else if (user.warnings >= 9) {
        user.is_perm_banned = true;
        punishment = "Permanent Blacklist";
    }
    await user.save();
    
    const customer = await client.users.fetch(user.user_id).catch(() => null);
    if (customer) {
        customer.send({ embeds: [createEmbed("⚠️ Discipline Issued", `**Reason:** ${reason}\n**Strikes:** ${user.warnings}\n**Penalty:** ${punishment}`, COLOR_FAIL)] }).catch(() => {});
    }
    client.channels.cache.get(CHAN_WARNINGS)?.send({ embeds: [createEmbed("🛡️ Discipline Log", `User: <@${user.user_id}>\nReason: ${reason}\nPenalty: ${punishment}`, COLOR_FAIL)] });
    return punishment;
}

async function executeQuotaRun(interaction = null) {
    const users = await User.find({ $or: [{ cook_count_total: { $gt: 0 } }, { deliver_count_total: { $gt: 0 } }] });
    
    const topStaff = [...users].sort((a, b) => (b.cook_count_week + b.deliver_count_week) - (a.cook_count_week + a.deliver_count_week)).slice(0, 5);
    const totalWork = users.reduce((acc, u) => acc + u.deliver_count_week + u.cook_count_week, 0);
    
    let globalQuota = Math.ceil(totalWork / Math.max(1, users.length));
    if (globalQuota < 5) globalQuota = 5;

    let passedList = [];
    let failedList = [];

    for (const u of users) {
        let target = globalQuota;
        try {
            const member = await client.guilds.cache.get(CONF_HQ_ID).members.fetch(u.user_id);
            if (member.roles.cache.has(ROLE_QUOTA_EXEMPT)) continue;
            else if (member.roles.cache.has(ROLE_TRAINEE_COOK) || member.roles.cache.has(ROLE_TRAINEE_DELIVERY)) target = 5;
            else if (member.roles.cache.has(ROLE_SENIOR_COOK) || member.roles.cache.has(ROLE_SENIOR_DELIVERY)) target = Math.ceil(globalQuota / 2);
        } catch (e) {}

        const total = u.cook_count_week + u.deliver_count_week;
        if (total < target) {
            await applyWarningLogic(u, "Failed Weekly Quota");
            failedList.push(`<@${u.user_id}> (${total}/${target})`);
        } else {
            passedList.push(`<@${u.user_id}> (${total}/${target})`);
        }

        u.cook_count_week = 0; u.deliver_count_week = 0; await u.save();
    }

    const leaders = topStaff.map((u, i) => `\`#${i+1}\` <@${u.user_id}>: **${u.cook_count_week + u.deliver_count_week}**`).join('\n') || "None.";
    const passedStr = passedList.join('\n') || "None.";
    const failedStr = failedList.join('\n') || "None.";

    const embed = createEmbed("📊 Weekly Quota Audit", `**Global Quota:** ${globalQuota} Actions`, COLOR_MAIN)
        .addFields(
            { name: "🏆 Top Performers", value: leaders },
            { name: "✅ Passed", value: passedStr.length > 1024 ? passedStr.substring(0, 1021) + "..." : passedStr },
            { name: "❌ Failed", value: failedStr.length > 1024 ? failedStr.substring(0, 1021) + "..." : failedStr }
        );

    client.channels.cache.get(CHAN_QUOTA)?.send({ content: "@here 📢 **WEEKLY AUDIT COMPLETE**", embeds: [embed] });
}

async function updateOrderArchive(orderId) {
    try {
        const channel = await client.channels.fetch(CHAN_BACKUP).catch(() => null);
        const order = await Order.findOne({ order_id: orderId });
        if (!channel || !order) return;
        
        let color = COLOR_MAIN;
        if (order.is_super) color = COLOR_FAIL;
        else if (order.is_vip) color = COLOR_VIP;
        if (order.is_partner_order) color = COLOR_PARTNER;

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

// ============================================================================
// [4] INTERACTION ROUTER
// ============================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message]
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            const [action, ...args] = interaction.customId.split('_');
            if (action === 'complete') {
                const o = await Order.findOne({ order_id: args[0] });
                try { await client.guilds.cache.get(o.guild_id).members.fetch(interaction.user.id); } catch (e) {
                    o.status = 'ready'; o.deliverer_id = null; await o.save();
                    updateOrderArchive(o.order_id); 
                    return interaction.update({ embeds: [createEmbed("PAYMENT FORFEITED", "Presence in destination server required for pay claim. Order reset.", COLOR_FAIL)], components: [] });
                }
                o.status = 'delivered'; await o.save();
                updateOrderArchive(o.order_id); 
                await User.findOneAndUpdate({ user_id: interaction.user.id }, { $inc: { balance: 30, deliver_count_week: 1, deliver_count_total: 1 } });
                return interaction.update({ embeds: [createEmbed("CONFIRMED", "30 Sugar Coins added to vault.", COLOR_SUCCESS)], components: [] });
            }
            if (action.startsWith('approve')) {
                if (!interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Management Only.", COLOR_FAIL)], ephemeral: true });
                const uid = args[0];
                const member = await client.guilds.cache.get(CONF_HQ_ID).members.fetch(uid).catch(() => null);
                if (member) await member.roles.add(ROLE_QUOTA_EXEMPT);
                return interaction.update({ embeds: [createEmbed("✅ Approved", "Vacation request granted.", COLOR_SUCCESS)], components: [] });
            }
            if (action.startsWith('deny')) {
                if (!interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Management Only.", COLOR_FAIL)], ephemeral: true });
                return interaction.update({ embeds: [createEmbed("❌ Denied", "Vacation request denied.", COLOR_FAIL)], components: [] });
            }
        }

        if (!interaction.isChatInputCommand()) return;
        const { commandName, options } = interaction;
        const userData = await User.findOne({ user_id: interaction.user.id }) || new User({ user_id: interaction.user.id });

        // GATES
        if (userData.is_perm_banned || (userData.service_ban_until > Date.now())) {
            return interaction.reply({ embeds: [createEmbed("❌ Access Denied", `You are currently banned from using Sugar Rush Serivces\n Belive this is a mistake?\n DM us to Open a Support ticket`, COLOR_FAIL)], ephemeral: true });
        }
        
        const isServerBlacklisted = await ServerBlacklist.findOne({ guild_id: interaction.guildId });
        if (isServerBlacklisted) {
            return interaction.reply({ embeds: [createEmbed("❌ Server Blacklisted", `**Reason:** ${isServerBlacklisted.reason}\nBelive this is a mistake or wish to appeal?\nDM us to Open a Support Ticket.`, COLOR_FAIL)], ephemeral: false });
        }

        // HELP
        if (commandName === 'help') {
            const fields = [
                { name: "🛡️ Management", value: "`/partner_add`, `/partner_remove`, `/generate_codes`, `/fdo`, `/force_warn`, `/run_quota`, `/ban`, `/unban`, `/refund`, `/serverblacklist`" },
                { name: "💰 Economy", value: "`/balance`, `/daily`, `/tip`, `/redeem`, `/premium`" },
                { name: "📦 Ordering", value: "`/order`, `/super_order`, `/orderstatus`, `/orderinfo`, `/rate`, `/review`" },
                { name: "👨‍🍳 Staff", value: "`/claim`, `/cook`, `/orderlist`, `/deliver`, `/deliverylist`, `/setscript`, `/stats`, `/vacation`, `/staff_buy`" },
                { name: "🔗 Utility", value: "`/partners`, `/help`, `/invite`, `/support`, `/rules`, `/warn`" }
            ];
            return interaction.reply({ embeds: [createEmbed("📖 Sugar Rush Directory", "Complete Protocol", COLOR_MAIN, fields)] });
        }

        if (commandName === 'partner_add') {
            if (!interaction.member.roles.cache.has(ROLE_PR_LEAD)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Public Relations Lead Only.", COLOR_FAIL)], ephemeral: true });
            await PartnerServer.findOneAndUpdate({ guild_id: options.getString('id') }, { added_by: interaction.user.id }, { upsert: true });
            return interaction.reply({ embeds: [createEmbed("🎉 Partner Added", `Server ID: ${options.getString('id')} is now a verified partner. Orders here will be FREE.`, COLOR_PARTNER)] });
        }

        if (commandName === 'partner_remove') {
            if (!interaction.member.roles.cache.has(ROLE_PR_LEAD)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Public Relations Lead Only.", COLOR_FAIL)], ephemeral: true });
            await PartnerServer.deleteOne({ guild_id: options.getString('id') });
            return interaction.reply({ embeds: [createEmbed("💔 Partner Removed", `Server ID: ${options.getString('id')} removed from registry.`, COLOR_FAIL)] });
        }

        if (commandName === 'generate_codes') {
            if (interaction.user.id !== CONF_OWNER) return interaction.reply({ embeds: [createEmbed("❌ Unauthorized", "Owner Only.", COLOR_FAIL)] });
            const amt = options.getInteger('amount');
            const codes = [];
            for (let i = 0; i < amt; i++) {
                const c = `VIP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
                await new VIPCode({ code: c }).save();
                codes.push(c);
            }
            await interaction.user.send({ embeds: [createEmbed("✅ Generated Codes", `Codes:\n${codes.join('\n')}`, COLOR_SUCCESS)] }).catch(() => {});
            return interaction.reply({ embeds: [createEmbed("✅ Generated", `Created ${codes.length} codes. Sent to DMs.`, COLOR_SUCCESS)], ephemeral: true });
        }

        if (commandName === 'serverblacklist') {
            if (interaction.user.id !== CONF_OWNER) return interaction.reply({ embeds: [createEmbed("❌ Unauthorized", "Owner Only.", COLOR_FAIL)] });
            await new ServerBlacklist({ guild_id: options.getString('id'), reason: options.getString('reason') }).save();
            return interaction.reply({ embeds: [createEmbed("✅ Server Blacklisted", `ID: ${options.getString('id')}`, COLOR_SUCCESS)] });
        }

        if (commandName === 'unserverblacklist') {
            if (interaction.user.id !== CONF_OWNER) return interaction.reply({ embeds: [createEmbed("❌ Unauthorized", "Owner Only.", COLOR_FAIL)] });
            await ServerBlacklist.deleteOne({ guild_id: options.getString('id') });
            return interaction.reply({ embeds: [createEmbed("✅ Server Restored", `ID: ${options.getString('id')}`, COLOR_SUCCESS)] });
        }

        if (['warn', 'fdo', 'force_warn'].includes(commandName)) {
            if (['fdo', 'force_warn'].includes(commandName) && !interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Management Only.", COLOR_FAIL)] });
            if (commandName === 'warn' && !interaction.member.roles.cache.has(ROLE_COOK) && !interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Cooks/Management Only.", COLOR_FAIL)] });
            
            const o = await Order.findOne({ order_id: options.getString('id') });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Order not found.", COLOR_FAIL)] });
            if (commandName === 'warn' && !['pending', 'claimed'].includes(o.status)) return interaction.reply({ embeds: [createEmbed("❌ Error", "Pre-cook orders only.", COLOR_FAIL)] });
            if (commandName === 'fdo' && o.status !== 'ready') return interaction.reply({ embeds: [createEmbed("❌ Error", "Ready orders only.", COLOR_FAIL)] });
            
            const target = await User.findOne({ user_id: o.user_id }) || new User({ user_id: o.user_id });
            const pen = await applyWarningLogic(target, options.getString('reason'));
            o.status = commandName === 'warn' ? 'cancelled_warn' : 'cancelled_fdo'; await o.save();
            updateOrderArchive(o.order_id); 
            return interaction.reply({ embeds: [createEmbed("✅ Action Logged", `Penalty: ${pen}`, COLOR_SUCCESS)] });
        }

        if (commandName === 'ban') {
            if (!interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Management Only.", COLOR_FAIL)] });
            await User.findOneAndUpdate({ user_id: options.getString('uid') }, { service_ban_until: new Date(Date.now() + options.getInteger('days') * 86400000) });
            return interaction.reply({ embeds: [createEmbed("✅ Banned", "User service ban applied.", COLOR_SUCCESS)] });
        }

        if (commandName === 'unban') {
            if (!interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Management Only.", COLOR_FAIL)] });
            await User.findOneAndUpdate({ user_id: options.getString('uid') }, { service_ban_until: null, is_perm_banned: false });
            return interaction.reply({ embeds: [createEmbed("✅ Unbanned", "User service restored.", COLOR_SUCCESS)] });
        }

        if (commandName === 'refund') {
            if (!interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Management Only.", COLOR_FAIL)] });
            const o = await Order.findOne({ order_id: options.getString('id') });
            if (o) await User.findOneAndUpdate({ user_id: o.user_id }, { $inc: { balance: 100 } });
            o.status = 'refunded'; await o.save();
            updateOrderArchive(o.order_id); 
            return interaction.reply({ embeds: [createEmbed("✅ Refunded", "Order refunded successfully.", COLOR_SUCCESS)] });
        }

        if (commandName === 'balance') return interaction.reply({ embeds: [createEmbed("💰 Vault", `Balance: **${userData.balance} Sugar Coins**`)] });

        if (commandName === 'daily') {
            if (Date.now() - userData.last_daily < 86400000) return interaction.reply({ embeds: [createEmbed("⏰ Cooldown", "Please wait 24h.", COLOR_FAIL)] });
            const pay = userData.vip_until > Date.now() ? 2000 : 1000;
            userData.balance += pay; userData.last_daily = Date.now(); await userData.save();
            return interaction.reply({ embeds: [createEmbed("💰 Daily Claimed", `+${pay} Sugar Coins.`, COLOR_SUCCESS)] });
        }

        if (commandName === 'tip') {
            const o = await Order.findOne({ order_id: options.getString('id') });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Order not found.", COLOR_FAIL)] });
            const amt = options.getInteger('amount');
            if (userData.balance < amt) return interaction.reply({ embeds: [createEmbed("❌ Error", "Insufficient balance.", COLOR_FAIL)] });
            userData.balance -= amt; await userData.save();
            if (o.chef_id) await User.findOneAndUpdate({ user_id: o.chef_id }, { $inc: { balance: amt } });
            return interaction.reply({ embeds: [createEmbed("💸 Tipped", `${amt} Sugar Coins sent to staff.`, COLOR_SUCCESS)] });
        }

        if (commandName === 'redeem') {
            const code = await VIPCode.findOne({ code: options.getString('code'), is_used: false });
            if (!code) return interaction.reply({ embeds: [createEmbed("❌ Invalid Code", "This code is invalid or has already been used.", COLOR_FAIL)], ephemeral: true });
            const now = new Date();
            const current = userData.vip_until > now ? userData.vip_until.getTime() : now.getTime();
            userData.vip_until = new Date(current + (30 * 86400000));
            code.is_used = true; await code.save(); await userData.save();
            return interaction.reply({ embeds: [createEmbed("💎 VIP Redeemed", `**Status Active Until:** ${userData.vip_until.toDateString()}`, COLOR_VIP)] });
        }

        if (commandName === 'premium') return interaction.reply({ embeds: [createEmbed("💎 Premium Store", `**[Click to Visit Shop](${CONF_STORE})**`, COLOR_VIP)] });

        if (commandName === 'order' || commandName === 'super_order') {
            const isVip = userData.vip_until > Date.now();
            let cost = commandName === 'super_order' ? 150 : 100;
            if (isVip) cost = Math.ceil(cost * 0.5); // VIP Discount

            // [NEW] CHECK FOR PARTNER SERVER
            const isPartner = await PartnerServer.findOne({ guild_id: interaction.guildId });
            let isPartnerOrder = false;
            
            if (isPartner) {
                cost = 0; // FREE!
                isPartnerOrder = true;
            }

            // [NEW] OVERFLOW PROTECTION WITH PAID BYPASS
            const queueCount = await Order.countDocuments({ status: 'pending' });
            const MAX_QUEUE = 30;
            const BYPASS_FEE = 75;

            if (queueCount >= MAX_QUEUE) {
                let isFreeBypass = false;
                
                // VIP: Check Cooldown (6 Hours)
                if (isVip) {
                    if (Date.now() - userData.last_overflow_bypass >= 21600000) { 
                        isFreeBypass = true;
                        userData.last_overflow_bypass = Date.now(); 
                        await userData.save();
                    }
                }

                if (!isFreeBypass) {
                    // OFFER PAID BYPASS
                    const totalCost = cost + BYPASS_FEE;

                    // 1. Check if they are broke
                    if (userData.balance < totalCost) {
                        return interaction.reply({ 
                            embeds: [createEmbed("⛔ Kitchen Overflow", `The kitchen is full (${queueCount}/${MAX_QUEUE}).\nYou need **${totalCost} Sugar Coins** (Base: ${cost} + Bypass: ${BYPASS_FEE}) to skip the line, but you are broke.`, COLOR_FAIL)], 
                            ephemeral: true 
                        });
                    }

                    // 2. Offer Buttons
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('buy_bypass').setLabel(`Pay Bypass (+${BYPASS_FEE})`).setStyle(ButtonStyle.Success).setEmoji('🚀'),
                        new ButtonBuilder().setCustomId('cancel_order').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    );

                    const msg = await interaction.reply({
                        embeds: [createEmbed("⚠️ Kitchen Capacity Reached", `Queue is full (${queueCount}/${MAX_QUEUE}).\n\n**Standard ordering is paused.**\nWould you like to pay an extra **${BYPASS_FEE} Sugar Coins** to bypass the queue?`, COLOR_VIP)],
                        components: [row],
                        ephemeral: true,
                        fetchReply: true
                    });

                    // 3. Handle Button Click
                    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 15000 });

                    collector.on('collect', async i => {
                        if (i.customId === 'cancel_order') {
                            return i.update({ content: "❌ Cancelled.", embeds: [], components: [] });
                        }

                        if (i.customId === 'buy_bypass') {
                            // Re-verify Balance
                            const freshUser = await User.findOne({ user_id: interaction.user.id });
                            if (freshUser.balance < totalCost) return i.update({ content: "❌ Insufficient funds.", components: [] });

                            // Execute Purchase
                            freshUser.balance -= totalCost;
                            await freshUser.save();

                            // Create Order (Duplicate logic to ensure safety within closure)
                            const count = await Order.countDocuments({ user_id: interaction.user.id, status: { $in: ['pending', 'claimed', 'cooking', 'ready'] } });
                            if (count >= 3) return i.update({ content: "❌ Limit Reached (3 active orders).", components: [] });

                            const oid = Math.random().toString(36).substring(2, 8).toUpperCase();
                            const cookChan = client.channels.cache.get(CHAN_COOK);
                            let kitchenMsgId = null;
                            if (cookChan) {
                                const m = await cookChan.send({ 
                                    content: "@here 🚀 **PRIORITY BYPASS**", 
                                    embeds: [createEmbed(
                                        commandName === 'super_order' ? "🚀 SUPER ORDER (BYPASS)" : "🍩 New Order (BYPASS)", 
                                        `**ID:** ${oid}\n**Item:** ${options.getString('item')}\n**Server:** ${interaction.guild.name}\n**Channel:** #${interaction.channel.name}`
                                    )] 
                                });
                                kitchenMsgId = m.id;
                            }
                            await new Order({ 
                                order_id: oid, 
                                user_id: interaction.user.id, 
                                guild_id: interaction.guildId, 
                                guild_name: interaction.guild.name,
                                channel_id: interaction.channelId, 
                                channel_name: interaction.channel.name,
                                item: options.getString('item'), 
                                is_vip: isVip, 
                                is_super: commandName === 'super_order', 
                                is_partner_order: isPartnerOrder, 
                                kitchen_msg_id: kitchenMsgId 
                            }).save();
                            updateOrderArchive(oid);

                            return i.update({ embeds: [createEmbed("✅ Bypassed", `Paid **${totalCost} Coins**. Order sent to kitchen.`, COLOR_SUCCESS)], components: [] });
                        }
                    });
                    
                    return; // STOP EXECUTION HERE (Do not run standard logic below)
                }
                // If isFreeBypass was true, we fall through to standard logic below
            }

            // STANDARD ORDER LOGIC (Queue Not Full OR Free Bypass Used)
            if (userData.balance < cost) return interaction.reply({ embeds: [createEmbed("❌ Insufficient Funds", `Need ${cost} Sugar Coins.`, COLOR_FAIL)] });
            const count = await Order.countDocuments({ user_id: interaction.user.id, status: { $in: ['pending', 'claimed', 'cooking', 'ready'] } });
            if (count >= 3) return interaction.reply({ embeds: [createEmbed("❌ Limit", "3 active orders max.", COLOR_FAIL)] });
            
            const oid = Math.random().toString(36).substring(2, 8).toUpperCase();
            const cookChan = client.channels.cache.get(CHAN_COOK);
            let kitchenMsgId = null;
            if (cookChan) {
                const msg = await cookChan.send({ 
                    content: commandName === 'super_order' ? "@here 🚀 **PRIORITY**" : null, 
                    embeds: [createEmbed(
                        commandName === 'super_order' ? "🚀 SUPER ORDER" : (isVip ? "💎 VIP ORDER" : "🍩 New Order"), 
                        `**ID:** ${oid}\n**Item:** ${options.getString('item')}\n**Server:** ${interaction.guild.name}\n**Channel:** #${interaction.channel.name}`
                    )] 
                });
                kitchenMsgId = msg.id;
            }
            await new Order({ 
                order_id: oid, 
                user_id: interaction.user.id, 
                guild_id: interaction.guildId, 
                guild_name: interaction.guild.name, 
                channel_id: interaction.channelId, 
                channel_name: interaction.channel.name, 
                item: options.getString('item'), 
                is_vip: isVip, 
                is_super: commandName === 'super_order',
                is_partner_order: isPartnerOrder, 
                kitchen_msg_id: kitchenMsgId 
            }).save();
            userData.balance -= cost; await userData.save();
            updateOrderArchive(oid);
            
            // [UPDATED] Partner Order Confirmation Message
            if (isPartnerOrder) {
                return interaction.reply({ embeds: [createEmbed("🎉 Partner Order (FREE)", `Thank you for ordering in **${interaction.guild.name}**, one of our verified partners!\nYour order has been sent to the kitchen at **no cost**.`, COLOR_PARTNER)] });
            } else {
                return interaction.reply({ embeds: [createEmbed("✅ Authorized", "Sent to kitchen.", COLOR_SUCCESS)] });
            }
        }

        if (commandName === 'orderstatus') {
            const orders = await Order.find({ user_id: interaction.user.id, status: { $in: ['pending', 'claimed', 'cooking', 'ready', 'delivering'] } });
            return interaction.reply({ embeds: [createEmbed("🍩 Active Orders", orders.map(o => `• \`${o.order_id}\`: ${o.status}`).join('\n') || "None.")] });
        }

        if (commandName === 'orderinfo' || commandName === 'oinfo') {
            const o = await Order.findOne({ order_id: options.getString('id') });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Not found.", COLOR_FAIL)] });
            return interaction.reply({ embeds: [createEmbed(`Info: ${o.order_id}`, `Item: ${o.item}\nStatus: ${o.status.toUpperCase()}`)] });
        }

        if (commandName === 'rate') {
            const o = await Order.findOne({ order_id: options.getString('order_id') });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Not found.", COLOR_FAIL)] });
            o.rating = options.getInteger('stars'); o.feedback = options.getString('feedback') || ""; o.rated = true; await o.save();
            return interaction.reply({ embeds: [createEmbed("⭐ Rated", "Thank you for your feedback!", COLOR_SUCCESS)] });
        }

        if (commandName === 'review') {
            client.channels.cache.get(CHAN_RATINGS)?.send({ embeds: [createEmbed("Review", `**Stars:** ${options.getInteger('rating')}\n**Msg:** ${options.getString('comment')}`)] });
            return interaction.reply({ embeds: [createEmbed("✅ Submitted", "Review published.", COLOR_SUCCESS)] });
        }

        if (commandName === 'claim') {
            if (!interaction.member.roles.cache.has(ROLE_COOK)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Cooks only.", COLOR_FAIL)] });
            const o = await Order.findOne({ order_id: options.getString('id'), status: 'pending' });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Invalid ID.", COLOR_FAIL)] });
            o.status = 'claimed'; o.chef_id = interaction.user.id; o.chef_name = interaction.user.username; await o.save();
            
            // [MODIFIED] Silent Claim for Standard Users. Only VIP/Partner/Super get DMs here.
            if (o.is_vip || o.is_partner_order || o.is_super) {
                client.users.fetch(o.user_id).then(u => u.send({ embeds: [createEmbed("👨‍🍳 Order Claimed", `Your order \`${o.order_id}\` has been claimed by **${interaction.user.username}**.`, COLOR_SUCCESS)] }).catch(() => {}));
            }

            updateOrderArchive(o.order_id); 
            setTimeout(async () => {
                const check = await Order.findOne({ order_id: o.order_id });
                if (check && check.status === 'claimed') { check.status = 'pending'; check.chef_id = null; await check.save(); }
            }, 300000);
            return interaction.reply({ embeds: [createEmbed("👨‍🍳 Claimed", "Assigned to you.", COLOR_SUCCESS)] });
        }

        if (commandName === 'cook') {
            if (!interaction.member.roles.cache.has(ROLE_COOK)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Cooks only.", COLOR_FAIL)] });
            const o = await Order.findOne({ order_id: options.getString('id'), status: 'claimed', chef_id: interaction.user.id });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Not claimed by you.", COLOR_FAIL)] });
            const proofs = [];
            if (options.getAttachment('image')) proofs.push(options.getAttachment('image').url);
            if (options.getAttachment('image2')) proofs.push(options.getAttachment('image2').url);
            if (options.getAttachment('image3')) proofs.push(options.getAttachment('image3').url);
            o.status = 'cooking'; o.images = proofs; await o.save();
            updateOrderArchive(o.order_id); 
            
            // [RETAINED] Everyone gets the "In Oven" notification
            client.users.fetch(o.user_id).then(u => u.send({ embeds: [createEmbed("♨️ Cooking", `Your order \`${o.order_id}\` is now being cooked!`, COLOR_MAIN)] }).catch(() => {}));
            
            let cookTime = 180000; 
            if (o.is_vip || o.is_partner_order) {
                cookTime = 60000; 
            }

            setTimeout(async () => {
                await Order.findOneAndUpdate({ order_id: o.order_id }, { status: 'ready', ready_at: new Date() });
                updateOrderArchive(o.order_id); 
                client.channels.cache.get(CHAN_DELIVERY).send({ embeds: [createEmbed("🥡 Order Ready", `**ID:** ${o.order_id}\n**Customer:** <@${o.user_id}>\n**Server:** ${o.guild_name}\n**Channel:** #${o.channel_name}`)] });
                
                // [NEW] VIP/Partner/Super Notification for "Ready" + Delivery Promise
                if (o.is_vip || o.is_partner_order || o.is_super) {
                     client.users.fetch(o.user_id).then(u => u.send({ embeds: [createEmbed("✅ Order Ready", `**Your order is fully cooked and waiting in the Delivery Room.**\n\n⏱️ **Promise:** A driver will deliver this shortly.\nIf no driver is available, our **Auto-System will deliver it within the hour.**`, COLOR_SUCCESS)] }).catch(() => {}));
                }

            }, cookTime);

            return interaction.reply({ embeds: [createEmbed("♨️ Cooking", `Started timer (${cookTime / 60000}m). Proofs: ${proofs.length}`)] });
        }

        if (commandName === 'deliver') {
            if (!interaction.member.roles.cache.has(ROLE_DELIVERY)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Drivers only.", COLOR_FAIL)] });
            const o = await Order.findOne({ order_id: options.getString('id'), status: 'ready' });
            if (!o) return interaction.reply({ embeds: [createEmbed("❌ Error", "Not ready.", COLOR_FAIL)] });
            try {
                const guild = client.guilds.cache.get(o.guild_id);
                const inv = await guild.channels.cache.random().createInvite();
                o.status = 'delivering'; o.deliverer_id = interaction.user.id; await o.save();
                updateOrderArchive(o.order_id); 
                
                // [UPDATED] FETCH CUSTOM SCRIPT & APPLY ALL PLACEHOLDERS
                const driverData = await Script.findOne({ user_id: interaction.user.id });
                let msgContent = driverData ? driverData.script : "Hello {user}! 🍩\nHere is your **{item}** from **Sugar Rush**.\n\nThank you for ordering with us! If you enjoyed the service, please consider leaving a rating.";
                
                // [FIXED] FULL PLACEHOLDER SUPPORT
                msgContent = msgContent
                    .replace(/{user}/g, `<@${o.user_id}>`)
                    .replace(/{item}/g, o.item)
                    .replace(/{server}/g, o.guild_name || "the server")
                    .replace(/{channel}/g, o.channel_name ? `#${o.channel_name}` : "your channel")
                    .replace(/{order_id}/g, o.order_id);

                const proofs = o.images?.length ? o.images.map((l, i) => `**Proof ${i+1}:** ${l}`).join('\n') : "None.";
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`complete_${o.order_id}`).setLabel('Confirm Delivery').setStyle(ButtonStyle.Success));
                
                await interaction.user.send({ 
                    content: `**📦 DISPATCH**\n\n` +
                             `**Dest:** ${inv.url}\n` +
                             `**User:** <@${o.user_id}>\n\n` +
                             `**📜 COPY & PASTE THIS SCRIPT:**\n` +
                             `\`\`\`\n${msgContent}\n\`\`\`\n\n` +
                             `**🍳 PROOFS:**\n${proofs}`, 
                    components: [row] 
                });
                
                // 5 MINUTE TIMEOUT
                setTimeout(async () => {
                    const check = await Order.findOne({ order_id: o.order_id });
                    if (check && check.status === 'delivering') {
                        check.status = 'ready'; check.deliverer_id = null; await check.save();
                        updateOrderArchive(check.order_id); 
                    }
                }, 300000);

                return interaction.reply({ embeds: [createEmbed("📫 Dispatch", "Sent to DMs.", COLOR_SUCCESS)] });
            } catch (e) {
                // [UPDATED] BRANDED PROFESSIONAL AUTO-DELIVERY ON INVITE FAILURE
                const channel = await client.channels.fetch(o.channel_id).catch(() => null);
                if (channel) {
                    let proofsText = "None.";
                    if (o.images?.length > 0) {
                        proofsText = o.images.map((l, i) => `**Proof ${i+1}:** [View Image](${l})`).join('\n');
                    }
                    const embed = createEmbed("📦 Order Delivered", 
                        `Hello <@${o.user_id}>,\n\n` +
                        `Thank you for ordering with **Sugar Rush**!\n\n` +
                        `Our logistics team attempted to hand-deliver your order, but we were unable to generate a valid invite to your server. ` +
                        `To ensure you don't wait any longer, your package has been routed through our **Automated Express Dispatch**.\n\n` +
                        `**Order ID:** \`${o.order_id}\`\n` +
                        `**Item:** ${o.item}\n` +
                        `**Proofs:**\n${proofsText}`, 
                        COLOR_SUCCESS);
                    if (o.images && o.images.length > 0) {
                        embed.setImage(o.images[0]);
                    }
                    await channel.send({ content: `<@${o.user_id}>`, embeds: [embed] }).catch(() => {});
                }
                o.status = 'delivered'; o.deliverer_id = 'SYSTEM'; await o.save();
                updateOrderArchive(o.order_id); 
                return interaction.reply({ embeds: [createEmbed("🤖 Auto-Delivered", "Invite creation failed. Order delivered automatically via bot.", COLOR_SUCCESS)] });
            }
        }

        if (commandName === 'orderlist') {
            const orders = await Order.find({ status: 'pending' });
            return interaction.reply({ embeds: [createEmbed("📋 Kitchen Queue", orders.map(o => `• \`${o.order_id}\` | ${o.item}`).join('\n') || "Empty.")] });
        }

        if (commandName === 'deliverylist') {
            const orders = await Order.find({ status: 'ready' });
            return interaction.reply({ embeds: [createEmbed("📦 Delivery Queue", orders.map(o => `• \`${o.order_id}\` | <@${o.user_id}>`).join('\n') || "Empty.")] });
        }

        if (commandName === 'setscript') {
            // [NEW] INTERACTIVE SCRIPT SETUP
            await interaction.reply({ 
                embeds: [createEmbed("📜 Set Delivery Script", 
                    "Please **reply to this message** with your new delivery script.\n\n" +
                    "**Available Smart Placeholders:**\n" +
                    "`{user}` - Customers Mention\n" +
                    "`{item}` - Ordered Item\n" +
                    "`{server}` - Server Name\n" +
                    "`{channel}` - Channel Name\n" +
                    "`{order_id}` - Order ID\n\n" +
                    "**Example:**\n" +
                    "\"Hello {user}! Here is your {item}. Thanks for ordering from {server}!\"")], 
                ephemeral: true 
            });

            const filter = m => m.author.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

            collector.on('collect', async m => {
                const newScript = m.content;
                await Script.findOneAndUpdate({ user_id: interaction.user.id }, { script: newScript }, { upsert: true });
                await m.reply({ embeds: [createEmbed("✅ Script Updated", `Your new script has been saved!\n\n**Preview:**\n\`\`\`\n${newScript}\n\`\`\``, COLOR_SUCCESS)] });
                // Note: We don't delete user's message to keep record/context for them
            });

            collector.on('end', collected => {
                if (collected.size === 0) interaction.followUp({ content: "❌ Time expired. Script not updated.", ephemeral: true });
            });
            return; // STOP execution here
        }

        if (commandName === 'stats') {
            const u = await User.findOne({ user_id: options.getUser('user')?.id || interaction.user.id });
            return interaction.reply({ embeds: [createEmbed("📊 Statistics", `👨‍🍳 Cooks: ${u?.cook_count_total || 0}\n🚴 Deliveries: ${u?.deliver_count_total || 0}`)] });
        }

        if (commandName === 'vacation') {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success));
            client.channels.cache.get(CHAN_VACATION).send({ content: "Vacation Request", components: [row] });
            return interaction.reply({ embeds: [createEmbed("✅ Sent", "Request submitted.", COLOR_SUCCESS)] });
        }

        if (commandName === 'staff_buy') {
            if (userData.balance < 15000) return interaction.reply({ embeds: [createEmbed("❌ Error", "Need 15k Coins.", COLOR_FAIL)] });
            userData.balance -= 15000; await userData.save();
            return interaction.reply({ embeds: [createEmbed("✅ Upgraded", "Double Stats active (30d).", COLOR_SUCCESS)] });
        }

        if (commandName === 'invite') {
            const link = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=274878024769&scope=bot%20applications.commands`;
            return interaction.reply({ embeds: [createEmbed("🤖 Invite", `[Invite Sugar Rush](${link})`)] });
        }
        if (commandName === 'support') return interaction.reply({ embeds: [createEmbed("🆘 Support", CONF_SUPPORT_SERVER)] });
        
        // MODIFIED: Uses Trello fetchRules()
        if (commandName === 'rules') {
            const rulesText = await fetchRules();
            return interaction.reply({ embeds: [createEmbed("📖 Rules", rulesText)] });
        }
        
        if (commandName === 'partners') {
            const count = await PartnerServer.countDocuments();
            const embed = createEmbed("🤝 Sugar Rush Partnerships", 
                "Partnering with Sugar Rush brings sweet benefits to your community!\n\n" +
                "**📋 Standard Requirements:**\n" +
                "• **1,000 Active Members** (Bots excluded; subject to change).\n" +
                "• **Active Community** with consistent engagement.\n" +
                "• **Sugar Rush** must be active in the server.\n" +
                "• **Clean Record:** No moderation history with Sugar Rush in the past 5 months.\n\n" +
                "▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n" +
                "**💎 Verified Partner Perks:**\n" +
                "• **Free Economy:** All orders placed within Partner Servers are **100% FREE**.\n" +
                "• **Priority Support:** Direct line to our logistics team.\n" +
                "• **Marketing Boost:** We will list an Advertisement for your community in our Partners channel (with `@everyone`) and forward select announcements (Conditions apply).\n" +
                "• **Community Events:** Cross-server events and giveaways.\n\n" +
                `**🌐 Current Partners:** ${count} Servers\n\n` +
                "**📩 How to Apply:**\n" +
                "**This is the primary way to join.** Contact our **Public Relations Lead** or open a ticket in our Support Server to discuss partnership opportunities.\n\n" +
                "▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n" +
                "**🏆 Patreon Partnership Tier**\n" +
                "For communities that do not meet our activity requirements, or simply wish to support the project financially, we offer a dedicated Paid Tier.\n\n" +
                "**🎁 Owner Benefits:**\n" +
                "• Receive **5x VIP Codes (30-Day)** every single month to distribute to your members.\n" +
                "• **Rollover Policy:** Missed a month? You can claim the previous month too (Max **10 codes** per claim).\n" +
                "• **How to Claim:** Open a ticket in our Support Server each month to receive your code batch.\n\n" +
                `**[👉 Click here to view Patreon Tiers](${CONF_STORE})**\n\n` +
                "⚠️ **Notice:** Sugar Rush Operations reserves the right to revoke Partnership status or VIP privileges at any time for violations of our terms.",
                COLOR_PARTNER
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'run_quota') { if (!interaction.member.roles.cache.has(ROLE_MANAGER)) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Unauthorized.", COLOR_FAIL)] }); await executeQuotaRun(); return interaction.reply({ embeds: [createEmbed("✅ Audit", "Audit complete.", COLOR_SUCCESS)] }); }

    } catch (e) { 
        console.error(e); 
        if (!interaction.replied) await interaction.reply({ content: "❌ System Error.", ephemeral: true }).catch(() => {});
    }
});

// ============================================================================
// [5] MAINTENANCE & STATUS
// ============================================================================

let statusIndex = 0;
let topggTick = 0;

client.on('ready', async () => {
    mongoose.connect(CONF_MONGO);
    console.log("Sugar Rush Build Online.");
    postTopGGStats(client.guilds.cache.size, client.user.id);
    
    const commands = [
        { name: 'partner_add', description: 'Authorize Partner Server', options: [{ name: 'id', type: 3, description: 'Guild ID', required: true }] },
        { name: 'partner_remove', description: 'Revoke Partner Server', options: [{ name: 'id', type: 3, description: 'Guild ID', required: true }] },
        { name: 'generate_codes', description: 'Generate VIP codes', options: [{ name: 'amount', type: 4, description: 'Amount', required: true }] },
        { name: 'serverblacklist', description: 'Blacklist a server', options: [{ name: 'id', type: 3, description: 'Guild ID', required: true }, { name: 'reason', type: 3, description: 'Reason', required: true }] },
        { name: 'unserverblacklist', description: 'Unblacklist a server', options: [{ name: 'id', type: 3, description: 'Guild ID', required: true }] },
        { name: 'warn', description: 'Warn a user', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }, { name: 'reason', type: 3, description: 'Reason', required: true }] },
        { name: 'fdo', description: 'Force Discipline Order', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }, { name: 'reason', type: 3, description: 'Reason', required: true }] },
        { name: 'force_warn', description: 'Force Warn', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }, { name: 'reason', type: 3, description: 'Reason', required: true }] },
        { name: 'ban', description: 'Ban user', options: [{ name: 'uid', type: 3, description: 'User ID', required: true }, { name: 'days', type: 4, description: 'Days', required: true }] },
        { name: 'unban', description: 'Unban user', options: [{ name: 'uid', type: 3, description: 'User ID', required: true }] },
        { name: 'refund', description: 'Refund order', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }] },
        { name: 'run_quota', description: 'Run quota check' },
        { name: 'balance', description: 'Check balance' },
        { name: 'daily', description: 'Claim daily' },
        { name: 'tip', description: 'Tip staff', options: [{ name: 'order_id', type: 3, description: 'Order ID', required: true }, { name: 'amount', type: 4, description: 'Amount', required: true }] },
        { name: 'redeem', description: 'Redeem VIP code', options: [{ name: 'code', type: 3, description: 'Code', required: true }] },
        { name: 'premium', description: 'Premium store' },
        { name: 'order', description: 'Order item', options: [{ name: 'item', type: 3, description: 'Item', required: true }] },
        { name: 'super_order', description: 'Super order', options: [{ name: 'item', type: 3, description: 'Item', required: true }] },
        { name: 'orderstatus', description: 'Check status' },
        { name: 'orderinfo', description: 'Check info', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }] },
        { name: 'oinfo', description: 'Check info alias', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }] },
        { name: 'rate', description: 'Rate order', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }, { name: 'stars', type: 4, description: 'Stars', required: true }, { name: 'feedback', type: 3, description: 'Feedback', required: false }] },
        { name: 'review', description: 'Leave review', options: [{ name: 'rating', type: 4, description: 'Rating', required: true }, { name: 'comment', type: 3, description: 'Message', required: true }] },
        { name: 'claim', description: 'Claim order', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }] },
        { name: 'cook', description: 'Cook order', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }, { name: 'image', type: 11, description: 'Proof 1', required: true }, { name: 'image2', type: 11, description: 'Proof 2', required: false }, { name: 'image3', type: 11, description: 'Proof 3', required: false }] },
        { name: 'orderlist', description: 'View queue' },
        { name: 'deliver', description: 'Deliver order', options: [{ name: 'id', type: 3, description: 'Order ID', required: true }] },
        { name: 'deliverylist', description: 'View delivery queue' },
        { name: 'setscript', description: 'Set delivery script' },
        { name: 'stats', description: 'View stats', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
        { name: 'vacation', description: 'Request vacation', options: [{ name: 'duration', type: 4, description: 'Days', required: true }] },
        { name: 'staff_buy', description: 'Buy buff' },
        { name: 'invite', description: 'Get invite' },
        { name: 'support', description: 'Get support' },
        { name: 'partners', description: 'View partnership info' },
        { name: 'rules', description: 'Get rules' },
        { name: 'help', description: 'Get help directory' }
    ];
    await client.application.commands.set(commands);

    setInterval(async () => {
        try {
            const now = new Date();
            if (now.getDay() === 0 && now.getHours() === 0 && now.getMinutes() === 0) await executeQuotaRun(null);

            const serverCount = client.guilds.cache.size;
            const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

            const statuses = [
                { name: `Total Servers: ${serverCount}`, type: ActivityType.Watching },
                { name: `/order | Sugar Rush`, type: ActivityType.Playing },
                { name: `Users: ${totalUsers}`, type: ActivityType.Watching },
            ];

            client.user.setPresence({ activities: [statuses[statusIndex]], status: 'online' });
            statusIndex = (statusIndex + 1) % statuses.length;

            topggTick++;
            if (topggTick >= 30) {
                postTopGGStats(serverCount, client.user.id);
                topggTick = 0;
            }

            // [UPDATED] Auto Delivery Threshold: 55 Minutes
            const threshold = new Date(Date.now() - 55 * 60 * 1000);
            
            const stale = await Order.find({ status: 'ready', ready_at: { $lt: threshold } });
            for (const order of stale) {
                const channel = await client.channels.fetch(order.channel_id).catch(() => null);
                if (channel) {
                    let proofsText = "None.";
                    if (order.images?.length > 0) {
                        proofsText = order.images.map((l, i) => `**Proof ${i+1}:** [View Image](${l})`).join('\n');
                    }
                    const embed = createEmbed("📦 Order Delivered", `Hello <@${order.user_id}>,\nThank you for choosing Sugar Rush\n Our Delivery staff are unable to deliver Your order to you in person at the moment.\n But rest asured your order has therefore been handed off to me for Automated Delivery.\n\n**Order ID:** \`${order.order_id}\`\n**Item:** ${order.item}\n**Proofs:**\n${proofsText}`, COLOR_SUCCESS);
                    if (order.images && order.images.length > 0) {
                        embed.setImage(order.images[0]);
                    }
                    await channel.send({ content: `<@${order.user_id}>`, embeds: [embed] }).catch(() => {});
                }
                order.status = 'delivered'; order.deliverer_id = 'SYSTEM'; await order.save();
                updateOrderArchive(order.order_id); // [UPDATE ARCHIVE - AUTO SYSTEM]
            }
        } catch (e) { console.error(e); }
    }, 60000);
});

client.login(CONF_TOKEN);
