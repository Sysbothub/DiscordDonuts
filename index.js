require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionsBitField, REST, Routes, ActivityType 
} = require('discord.js');
const mongoose = require('mongoose');

// --- 1. CONFIGURATION ---
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

const BRAND_NAME = "Sugar Rush";
const BRAND_COLOR = 0xFFA500; // Orange
const ERROR_COLOR = 0xFF0000; // Red
const SUCCESS_COLOR = 0x2ECC71; // Green
const SUPPORT_SERVER_LINK = "https://discord.gg/ceT3Gqwquj";
const SUPPORT_SERVER_ID = '1454857011866112063';

// --- IDs ---
const ROLES = {
    COOK: '1454877400729911509',
    DELIVERY: '1454877287953469632',
    MANAGER: '1454876343878549630',
    OWNER: '662655499811946536',
    SENIOR_COOK: '0', 
    SENIOR_DELIVERY: '0',
    BYPASS: '1454936082591252534',
    VIP: '1454935878408605748'
};

const CHANNELS = {
    COOK: '1454879418999767122',
    DELIVERY: '1454880879741767754',
    WARNING: '1454881451161026637',
    VACATION: '1454909580894015754',
    BACKUP: '1454888266451910901',
    RATINGS: '1454884136740327557',
    COMPLAINT: '1454886383662665972',
    QUOTA: '1454895987322519672'
};

// --- 2. DATABASE SCHEMAS ---
const orderSchema = new mongoose.Schema({
    order_id: String,
    user_id: String,
    guild_id: String,
    channel_id: String,
    status: { type: String, default: 'pending' },
    item: String,
    is_vip: Boolean,
    created_at: { type: Date, default: Date.now },
    chef_name: String,
    deliverer_id: String,
    claimed_at: Date,
    ready_at: Date,
    images: [String],
    rating: Number,
    backup_msg_id: String
});

const userSchema = new mongoose.Schema({
    user_id: String,
    cook_count_week: { type: Number, default: 0 },
    cook_count_total: { type: Number, default: 0 },
    deliver_count_week: { type: Number, default: 0 },
    deliver_count_total: { type: Number, default: 0 },
    quota_fails_cook: { type: Number, default: 0 },
    quota_fails_deliver: { type: Number, default: 0 },
    warnings: { type: Number, default: 0 },
    is_banned: { type: Number, default: 0 },
    ban_expires_at: Date
});

const premiumSchema = new mongoose.Schema({
    user_id: String,
    is_vip: Boolean,
    expires_at: Date
});

const codeSchema = new mongoose.Schema({
    code: String,
    status: { type: String, default: 'unused' },
    created_by: String
});

const vacationSchema = new mongoose.Schema({
    user_id: String,
    status: String,
    end_date: Date
});

const scriptSchema = new mongoose.Schema({
    user_id: String,
    script: String
});

const configSchema = new mongoose.Schema({
    key: String,
    date: Date
});

const Order = mongoose.model('Order', orderSchema);
const User = mongoose.model('User', userSchema);
const PremiumUser = mongoose.model('PremiumUser', premiumSchema);
const PremiumCode = mongoose.model('PremiumCode', codeSchema);
const Vacation = mongoose.model('Vacation', vacationSchema);
const Script = mongoose.model('Script', scriptSchema);
const Config = mongoose.model('Config', configSchema);

// --- 3. CLIENT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel],
    presence: {
        status: 'online',
        activities: [{ name: '/order | Sugar Rush', type: ActivityType.Playing }]
    }
});

// --- 4. HELPER FUNCTIONS ---
const getGlobalPerms = async (userId) => {
    if (userId === ROLES.OWNER) return { isStaff: true, isManager: true, isCook: true, isDelivery: true, isOwner: true };
    try {
        const supportGuild = client.guilds.cache.get(SUPPORT_SERVER_ID);
        if (!supportGuild) return { isStaff: false, isManager: false, isOwner: false }; 
        const member = await supportGuild.members.fetch(userId);
        const isCook = member.roles.cache.has(ROLES.COOK);
        const isDelivery = member.roles.cache.has(ROLES.DELIVERY);
        const isManager = member.roles.cache.has(ROLES.MANAGER);
        return { 
            isStaff: isCook || isDelivery || isManager, 
            isManager: isManager, 
            isCook: isCook, 
            isDelivery: isDelivery,
            isOwner: false
        };
    } catch (e) {
        return { isStaff: false, isManager: false, isOwner: false };
    }
};

const createEmbed = (title, description, color = BRAND_COLOR, fields = []) => {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || null)
        .setColor(color)
        .setFooter({ text: BRAND_NAME, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();
    if (fields.length > 0) embed.addFields(fields);
    return embed;
};

const updateMasterLog = async (orderId) => {
    try {
        const channel = await client.channels.fetch(CHANNELS.BACKUP).catch(() => null);
        if (!channel) return;
        const o = await Order.findOne({ order_id: orderId });
        if (!o) return;

        const embed = new EmbedBuilder()
            .setTitle(`🍩 Order #${o.order_id}`)
            .setColor(BRAND_COLOR)
            .addFields(
                { name: 'Status', value: `**${o.status.toUpperCase()}**`, inline: true },
                { name: 'Item', value: o.item, inline: true },
                { name: 'Client', value: `<@${o.user_id}>`, inline: true },
                { name: 'Chef', value: o.chef_name || 'None', inline: true },
                { name: 'Deliverer', value: o.deliverer_id ? `<@${o.deliverer_id}>` : 'None', inline: true }
            )
            .setTimestamp();

        if (!o.backup_msg_id) {
            const msg = await channel.send({ embeds: [embed] });
            o.backup_msg_id = msg.id;
            await o.save();
        } else {
            const msg = await channel.messages.fetch(o.backup_msg_id).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed] });
        }
    } catch (e) { console.error(e); }
};

const generateCode = () => `VIP-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

// --- 5. EVENTS ---

client.once('clientReady', async () => {
    console.log(`🚀 ${BRAND_NAME} is ONLINE as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '/order | Sugar Rush', type: ActivityType.Playing }], status: 'online' });

    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected to MongoDB");
    } catch (e) { console.error("❌ MongoDB Error:", e); }

    const commands = [
        { name: 'order', description: 'Order food', options: [{ name: 'item', type: 3, required: true, description: 'Item' }] },
        { name: 'claim', description: 'Claim order', options: [{ name: 'id', type: 3, required: true, description: 'ID' }] },
        { 
            name: 'cook', 
            description: 'Cook order', 
            options: [
                { name: 'id', type: 3, required: true, description: 'ID' }, 
                { name: 'image', type: 11, required: true, description: 'Proof 1' },
                { name: 'image2', type: 11, required: false, description: 'Proof 2' },
                { name: 'image3', type: 11, required: false, description: 'Proof 3' }
            ] 
        },
        { name: 'deliver', description: 'Deliver order', options: [{ name: 'id', type: 3, required: true, description: 'ID' }] },
        { name: 'setscript', description: 'Set delivery message', options: [{ name: 'message', type: 3, required: true, description: 'Script' }] },
        { name: 'invite', description: 'Get invite link' },
        { name: 'warn', description: 'Warn user', options: [{ name: 'id', type: 3, required: true, description: 'ID' }, { name: 'reason', type: 3, required: true, description: 'Reason' }] },
        { name: 'fdo', description: 'Force delete order', options: [{ name: 'id', type: 3, required: true, description: 'ID' }, { name: 'reason', type: 3, required: true, description: 'Reason' }] },
        { name: 'unban', description: 'Unban user', options: [{ name: 'user', type: 6, required: true, description: 'User' }] },
        { name: 'rules', description: 'View rules' },
        { name: 'generate_codes', description: 'Owner: Gen Codes', options: [{ name: 'amount', type: 4, required: true, description: 'Amount' }] },
        { name: 'redeem', description: 'Redeem VIP', options: [{ name: 'code', type: 3, required: true, description: 'Code' }] },
        { name: 'addvip', description: 'Owner: Give VIP', options: [{ name: 'user', type: 6, required: true, description: 'User' }] },
        { name: 'removevip', description: 'Owner: Revoke VIP', options: [{ name: 'user', type: 6, required: true, description: 'User' }] },
        { name: 'vacation', description: 'Request vacation', options: [{ name: 'days', type: 4, required: true, description: 'Days' }, { name: 'reason', type: 3, required: true, description: 'Reason' }] },
        { name: 'quota', description: 'Check your current quota status' },
        { name: 'stats', description: 'Check staff stats (Rating, Totals)', options: [{ name: 'user', type: 6, required: false, description: 'User' }] },
        { name: 'rate', description: 'Rate service', options: [{ name: 'id', type: 3, required: true, description: 'ID' }, { name: 'stars', type: 4, required: true, description: '1-5' }] },
        { name: 'complain', description: 'Complaint', options: [{ name: 'id', type: 3, required: true, description: 'ID' }, { name: 'reason', type: 3, required: true, description: 'Reason' }] },
        { name: 'orderlist', description: 'View queue' },
        { name: 'unclaim', description: 'Drop order', options: [{ name: 'id', type: 3, required: true, description: 'ID' }] },
        { name: 'runquota', description: 'Manager: Force Run Quota' }
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) { console.error(e); }
    
    // Status Heartbeat
    setInterval(() => {
        client.user.setPresence({ activities: [{ name: '/order | Sugar Rush', type: ActivityType.Playing }], status: 'online' });
    }, 300000); 

    setInterval(checkTasks, 60000);
});

// --- 6. AUTOMATED SYSTEMS ---

async function checkTasks() {
    const now = new Date();

    // 1. Auto Delivery Logic
    const threshold = new Date(now - 20 * 60000);
    const overdue = await Order.find({ status: 'ready', ready_at: { $lt: threshold } });
    
    for (const o of overdue) {
        try {
            const guild = client.guilds.cache.get(o.guild_id);
            if (guild) {
                const channel = guild.channels.cache.get(o.channel_id);
                if (channel) {
                    const embed = createEmbed("🤖 Auto-Delivery", `**Chef:** ${o.chef_name}\n\n*This order was automatically delivered because it waited over 20 minutes.*`, BRAND_COLOR);
                    if(o.images && o.images.length > 0) embed.setImage(o.images[0]);
                    
                    await channel.send({ content: `<@${o.user_id}>`, embeds: [embed] });
                    if(o.images.length > 1) await channel.send({ files: o.images.slice(1) });
                    
                    o.status = 'delivered';
                    o.deliverer_id = 'AUTO_BOT';
                    await o.save();
                    updateMasterLog(o.order_id);
                }
            }
        } catch(e) { console.error("Auto-Deliver Failed:", e); }
    }

    // 2. VIP Expiry Monitor
    const expiredVips = await PremiumUser.find({ is_vip: true, expires_at: { $lt: now } });
    for (const v of expiredVips) {
        v.is_vip = false; v.expires_at = null; await v.save();
        try {
            const supportGuild = client.guilds.cache.get(SUPPORT_SERVER_ID);
            if (supportGuild) {
                const member = await supportGuild.members.fetch(v.user_id).catch(() => null);
                if (member) await member.roles.remove(ROLES.VIP).catch(() => {});
            }
        } catch (e) {}
    }

    // 3. Weekly Quota
    if (now.getUTCDay() === 0 && now.getUTCHours() === 23) {
        const lastRun = await Config.findOne({ key: 'last_quota_run' });
        const twelveHours = 12 * 60 * 60 * 1000;
        if (!lastRun || (now - lastRun.date) > twelveHours) {
            for (const [id, guild] of client.guilds.cache) {
                await runQuotaLogic(guild);
            }
            await Config.findOneAndUpdate({ key: 'last_quota_run' }, { date: now }, { upsert: true });
        }
    }
}

const calculateTargets = (volume, staffCount) => {
    if (staffCount === 0) return { norm: 0, senior: 0 };
    let raw = Math.ceil(volume / staffCount);
    let norm = Math.min(raw, 30);
    let senior = Math.ceil(norm / 2);
    if (volume > 0) { norm = Math.max(1, norm); senior = Math.max(1, senior); }
    return { norm, senior };
};

async function runQuotaLogic(guild) {
    const quotaChannel = guild.channels.cache.get(CHANNELS.QUOTA);
    if (!quotaChannel) return;

    const cookRole = guild.roles.cache.get(ROLES.COOK);
    const delRole = guild.roles.cache.get(ROLES.DELIVERY);
    if(!cookRole || !delRole) return;
    await guild.members.fetch(); 

    const cooks = cookRole.members.map(m => m);
    const deliverers = delRole.members.map(m => m);

    const allUsers = await User.find({});
    let totalCook = 0; let totalDel = 0;
    
    for (const m of cooks) { const u = allUsers.find(u => u.user_id === m.id); if(u) totalCook += u.cook_count_week; }
    for (const m of deliverers) { const u = allUsers.find(u => u.user_id === m.id); if(u) totalDel += u.deliver_count_week; }

    const cTarget = calculateTargets(totalCook, cooks.length);
    const dTarget = calculateTargets(totalDel, deliverers.length);

    let report = `📊 **Weekly Quota Report**\n🍩 Total Cooked: ${totalCook} | 🚴 Total Delivered: ${totalDel}\n**Targets:** Normal \`${cTarget.norm}\` | Senior \`${cTarget.senior}\`\n\n`;

    report += `__**👨‍🍳 Kitchen Staff**__\n`;
    for (const m of cooks) {
        const u = await User.findOne({ user_id: m.id }) || new User({ user_id: m.id });
        const isSenior = m.roles.cache.has(ROLES.SENIOR_COOK);
        const target = isSenior ? cTarget.senior : cTarget.norm;
        const done = u.cook_count_week;
        const isBypass = m.roles.cache.has(ROLES.BYPASS);

        if (isBypass) {
            report += `🛡️ <@${m.id}>: Exempt\n`;
        } else if (done >= target) {
            u.quota_fails_cook = 0; report += `✅ <@${m.id}>: ${done}/${target}\n`;
        } else {
            u.quota_fails_cook += 1;
            if (u.quota_fails_cook >= 2) { m.roles.remove(ROLES.COOK).catch(()=>{}); u.quota_fails_cook = 0; report += `❌ <@${m.id}>: ${done}/${target} (**REMOVED**)\n`; }
            else { report += `⚠️ <@${m.id}>: ${done}/${target} (Strike ${u.quota_fails_cook}/2)\n`; }
        }
        u.cook_count_week = 0; await u.save();
    }

    report += `\n__**🚴 Delivery Staff**__\n`;
    for (const m of deliverers) {
        const u = await User.findOne({ user_id: m.id }) || new User({ user_id: m.id });
        const isSenior = m.roles.cache.has(ROLES.SENIOR_DELIVERY);
        const target = isSenior ? dTarget.senior : dTarget.norm;
        const done = u.deliver_count_week;
        const isBypass = m.roles.cache.has(ROLES.BYPASS);

        if (isBypass) {
            report += `🛡️ <@${m.id}>: Exempt\n`;
        } else if (done >= target) {
            u.quota_fails_deliver = 0; report += `✅ <@${m.id}>: ${done}/${target}\n`;
        } else {
            u.quota_fails_deliver += 1;
            if (u.quota_fails_deliver >= 2) { m.roles.remove(ROLES.DELIVERY).catch(()=>{}); u.quota_fails_deliver = 0; report += `❌ <@${m.id}>: ${done}/${target} (**REMOVED**)\n`; }
            else { report += `⚠️ <@${m.id}>: ${done}/${target} (Strike ${u.quota_fails_deliver}/2)\n`; }
        }
        u.deliver_count_week = 0; await u.save();
    }

    const embed = createEmbed("📊 Weekly Quota Report", report.substring(0, 4000), BRAND_COLOR);
    await quotaChannel.send({ embeds: [embed] });
}

// --- 7. INTERACTIONS ---
client.on('interactionCreate', async interaction => {
    const perms = await getGlobalPerms(interaction.user.id);

    // --- 7A. CHANNEL & SERVER RESTRICTIONS ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 1. KITCHEN CHANNEL LOCK (Claim, Cook) - Unless Manager/Owner
        if (['claim', 'cook'].includes(commandName)) {
            if (interaction.channelId !== CHANNELS.COOK && !perms.isManager && !perms.isOwner) {
                return interaction.reply({ embeds: [createEmbed("❌ Wrong Channel", `Please use this command in <#${CHANNELS.COOK}>.`, ERROR_COLOR)], ephemeral: true });
            }
        }

        // 2. DELIVERY CHANNEL LOCK (Deliver) - Unless Manager/Owner
        if (commandName === 'deliver') {
            if (interaction.channelId !== CHANNELS.DELIVERY && !perms.isManager && !perms.isOwner) {
                return interaction.reply({ embeds: [createEmbed("❌ Wrong Channel", `Please use this command in <#${CHANNELS.DELIVERY}>.`, ERROR_COLOR)], ephemeral: true });
            }
        }

        // 3. SUPPORT SERVER LOCK (All other staff commands)
        const restrictedCommands = ['warn', 'fdo', 'unban', 'vacation', 'quota', 'stats', 'runquota', 'addvip', 'removevip', 'generate_codes', 'setscript', 'orderlist'];
        if (restrictedCommands.includes(commandName)) {
            if (interaction.guildId !== SUPPORT_SERVER_ID && !perms.isOwner) {
                return interaction.reply({ embeds: [createEmbed("❌ Restricted", "This command can only be used in the **Support Server**.", ERROR_COLOR)], ephemeral: true });
            }
        }
        
        // 4. OWNER LOCK (Explicit check for strict owner commands)
        if (['addvip', 'removevip', 'generate_codes'].includes(commandName)) {
            if (!perms.isOwner) {
                return interaction.reply({ embeds: [createEmbed("❌ Restricted", "This command is restricted to the **Bot Owner**.", ERROR_COLOR)], ephemeral: true });
            }
        }
    }

    // --- 7B. BUTTON & MODAL HANDLING (VACATION) ---
    if (interaction.isButton()) {
        if (!perms.isManager && !perms.isOwner) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Managers only.", ERROR_COLOR)], ephemeral: true });
        
        const [action, userId, daysStr] = interaction.customId.split('_');
        const days = parseInt(daysStr);

        if (action === 'vacApprove') {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + days);

            await Vacation.findOneAndUpdate(
                { user_id: userId },
                { status: 'active', end_date: endDate },
                { upsert: true }
            );

            const supportGuild = client.guilds.cache.get(SUPPORT_SERVER_ID);
            if(supportGuild) {
                const target = await supportGuild.members.fetch(userId).catch(() => null);
                if (target) target.roles.add(ROLES.BYPASS).catch(() => {});
            }

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(SUCCESS_COLOR)
                .setFooter({ text: `Approved by ${interaction.user.username}` });

            await interaction.message.edit({ embeds: [embed], components: [] });
            await interaction.reply({ embeds: [createEmbed("✅ Approved", `Vacation approved for ${days} days.`, SUCCESS_COLOR)], ephemeral: true });
            
            try { 
                const u = await client.users.fetch(userId);
                u.send({ embeds: [createEmbed("🌴 Vacation Approved", `Your request for ${days} days has been approved! Enjoy your break.`, SUCCESS_COLOR)] }); 
            } catch(e){}
        }

        if (action === 'vacEdit') {
            const modal = new ModalBuilder().setCustomId(`vacModalEdit_${userId}`).setTitle("Edit Vacation Duration");
            const input = new TextInputBuilder().setCustomId('newDays').setLabel('New Duration (Days)').setStyle(TextInputStyle.Short);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        if (action === 'vacDeny') {
            const modal = new ModalBuilder().setCustomId(`vacModalDeny_${userId}`).setTitle("Deny Vacation Request");
            const input = new TextInputBuilder().setCustomId('denyReason').setLabel('Reason for Denial').setStyle(TextInputStyle.Paragraph);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        return;
    }

    if (interaction.isModalSubmit()) {
        const [action, userId] = interaction.customId.split('_');

        if (action === 'vacModalEdit') {
            const newDays = parseInt(interaction.fields.getTextInputValue('newDays'));
            if (isNaN(newDays) || newDays < 1 || newDays > 14) return interaction.reply({ embeds: [createEmbed("❌ Error", "Days must be 1-14.", ERROR_COLOR)], ephemeral: true });

            const endDate = new Date();
            endDate.setDate(endDate.getDate() + newDays);

            await Vacation.findOneAndUpdate(
                { user_id: userId },
                { status: 'active', end_date: endDate },
                { upsert: true }
            );

            const supportGuild = client.guilds.cache.get(SUPPORT_SERVER_ID);
            if(supportGuild) {
                const target = await supportGuild.members.fetch(userId).catch(() => null);
                if (target) target.roles.add(ROLES.BYPASS).catch(() => {});
            }

            const oldEmbed = interaction.message.embeds[0];
            const embed = EmbedBuilder.from(oldEmbed)
                .setColor(SUCCESS_COLOR)
                .setDescription(oldEmbed.description.replace(/Duration: \d+ Days/, `Duration: ${newDays} Days (Edited)`))
                .setFooter({ text: `Approved (Edited) by ${interaction.user.username}` });

            await interaction.message.edit({ embeds: [embed], components: [] });
            await interaction.reply({ embeds: [createEmbed("✅ Approved & Edited", `Vacation set to ${newDays} days.`, SUCCESS_COLOR)], ephemeral: true });
            
            try { 
                const u = await client.users.fetch(userId);
                u.send({ embeds: [createEmbed("🌴 Vacation Approved (Edited)", `Your request was modified and approved for ${newDays} days.`, SUCCESS_COLOR)] }); 
            } catch(e){}
        }

        if (action === 'vacModalDeny') {
            const reason = interaction.fields.getTextInputValue('denyReason');
            
            const oldEmbed = interaction.message.embeds[0];
            const embed = EmbedBuilder.from(oldEmbed)
                .setColor(ERROR_COLOR)
                .addFields({ name: "Denial Reason", value: reason })
                .setFooter({ text: `Denied by ${interaction.user.username}` });

            await interaction.message.edit({ embeds: [embed], components: [] });
            await interaction.reply({ embeds: [createEmbed("❌ Request Denied", "User has been notified.", SUCCESS_COLOR)], ephemeral: true });
            
            try { 
                const u = await client.users.fetch(userId);
                u.send({ embeds: [createEmbed("❌ Vacation Denied", `Reason: ${reason}`, ERROR_COLOR)] }); 
            } catch(e){}
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // --- ORDER ---
    if (commandName === 'order') {
        const item = interaction.options.getString('item');
        const oid = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const u = await User.findOne({ user_id: interaction.user.id });
        if(u && u.is_banned) return interaction.reply({ embeds: [createEmbed("🛑 Action Blocked", "You are permanently banned.", ERROR_COLOR)], ephemeral: true });
        
        const active = await Order.findOne({ user_id: interaction.user.id, status: { $in: ['pending', 'claimed', 'cooking', 'ready'] } });
        if (active) return interaction.reply({ embeds: [createEmbed("❌ Order Failed", "You already have an active order in the queue.", ERROR_COLOR)], ephemeral: true });

        const vipUser = await PremiumUser.findOne({ user_id: interaction.user.id, is_vip: true });
        const isVip = !!vipUser;

        await new Order({
            order_id: oid, user_id: interaction.user.id, guild_id: interaction.guild.id,
            channel_id: interaction.channel.id, item: item, is_vip: isVip
        }).save();

        updateMasterLog(oid);
        const channel = client.channels.cache.get(CHANNELS.COOK);
        if(channel) {
            const ping = isVip ? "@here" : "";
            const title = isVip ? "💎 VIP ORDER!" : "🍩 New Order!";
            const embed = createEmbed(title, `**Item:** ${item}\n**User:** <@${interaction.user.id}>\n**ID:** \`${oid}\``, isVip ? 0x9B59B6 : BRAND_COLOR);
            channel.send({ content: ping, embeds: [embed] });
        }
        await interaction.reply({ embeds: [createEmbed("✅ Order Placed", `Your order ID is \`${oid}\`. Sit tight!`, SUCCESS_COLOR)], ephemeral: true });
    }

    // --- CLAIM ---
    if (commandName === 'claim') {
        if (!perms.isStaff) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Staff only.", ERROR_COLOR)], ephemeral: true });
        const oid = interaction.options.getString('id');
        const order = await Order.findOne({ order_id: oid });
        if(!order || order.status !== 'pending') return interaction.reply({ embeds: [createEmbed("❌ Invalid Order", "Order not found or already claimed.", ERROR_COLOR)], ephemeral: true });
        
        order.status = 'claimed';
        order.chef_name = interaction.user.username;
        await order.save();
        updateMasterLog(oid);
        
        try { 
            const u = await client.users.fetch(order.user_id);
            u.send({ embeds: [createEmbed("👨‍🍳 Order Claimed", `Your order \`${oid}\` is being prepared by **${interaction.user.username}**!`, BRAND_COLOR)] });
        } catch(e){}
        
        await interaction.reply({ embeds: [createEmbed("👨‍🍳 Claimed", `You have claimed order \`${oid}\`. You have 4 minutes to cook!`, SUCCESS_COLOR)] });
    }

    // --- COOK ---
    if (commandName === 'cook') {
        if (!perms.isStaff) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Staff only.", ERROR_COLOR)], ephemeral: true });
        const oid = interaction.options.getString('id');
        const img1 = interaction.options.getAttachment('image');
        const img2 = interaction.options.getAttachment('image2');
        const img3 = interaction.options.getAttachment('image3');
        
        const order = await Order.findOne({ order_id: oid });
        if(!order || order.status !== 'claimed') return interaction.reply({ embeds: [createEmbed("❌ Invalid Order", "Order not claimed or invalid status.", ERROR_COLOR)], ephemeral: true });
        
        order.status = 'cooking';
        order.images = [img1.url];
        if(img2) order.images.push(img2.url); 
        if(img3) order.images.push(img3.url);
        await order.save();
        
        await User.findOneAndUpdate({ user_id: interaction.user.id }, { $inc: { cook_count_week: 1, cook_count_total: 1 } }, { upsert: true });
        updateMasterLog(oid);

        await interaction.reply({ embeds: [createEmbed("👨‍🍳 Cooking Started", `Order \`${oid}\` is cooking.\n\n⏱️ **Timer:** 3 Minutes`, BRAND_COLOR)] });

        setTimeout(async () => {
            const o = await Order.findOne({ order_id: oid });
            if(o && o.status === 'cooking') {
                o.status = 'ready';
                o.ready_at = new Date();
                await o.save();
                updateMasterLog(oid);

                const dc = client.channels.cache.get(CHANNELS.DELIVERY);
                if(dc) {
                    const embed = createEmbed("📦 Order Ready", `**ID:** \`${oid}\`\n**Chef:** ${interaction.user.username}\n\n*Waiting for Delivery Driver...*`, BRAND_COLOR);
                    dc.send({ embeds: [embed] });
                }

                try { 
                    const u = await client.users.fetch(o.user_id);
                    u.send({ embeds: [createEmbed("📦 Order Ready", `Your order \`${oid}\` is fresh out of the oven! A driver will pick it up soon.`, SUCCESS_COLOR)] });
                } catch(e){}
            }
        }, 180000); 
    }

    // --- SET SCRIPT ---
    if (commandName === 'setscript') {
        const msg = interaction.options.getString('message');
        await Script.findOneAndUpdate({ user_id: interaction.user.id }, { script: msg }, { upsert: true });
        await interaction.reply({ embeds: [createEmbed("✅ Script Saved", "Your custom delivery message has been updated.", SUCCESS_COLOR)], ephemeral: true });
    }

    // --- DELIVER ---
    if (commandName === 'deliver') {
        if (!perms.isStaff) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Staff only.", ERROR_COLOR)], ephemeral: true });
        const oid = interaction.options.getString('id');
        const order = await Order.findOne({ order_id: oid });
        if(!order || order.status !== 'ready') return interaction.reply({ embeds: [createEmbed("❌ Invalid Order", "Order not ready for delivery.", ERROR_COLOR)], ephemeral: true });

        const scriptDoc = await Script.findOne({ user_id: interaction.user.id });
        const script = scriptDoc ? scriptDoc.script : "Here is your order! 🍩";
        const guild = client.guilds.cache.get(order.guild_id);
        const channel = guild?.channels.cache.get(order.channel_id);
        
        let invite = null;
        if(channel) {
            try { invite = await channel.createInvite({ maxAge: 300, maxUses: 1 }); } catch(e) {}
        }

        if (invite) {
            try {
                const deliveryMsg = `**Chef:** ${order.chef_name}\n**Driver:** ${interaction.user.username}\n\n${script}`;
                await interaction.user.send({
                    content: `🚴 **Delivery Instructions for Order #${oid}**\n\n1. **Join Server:** ${invite.url}\n2. **Paste this Message:**\n\`\`\`\n${deliveryMsg}\n\`\`\`\n*(Don't forget to attach the images below!)*`,
                    files: order.images
                });
                
                order.status = 'delivered'; 
                order.deliverer_id = interaction.user.id;
                await order.save();
                
                await User.findOneAndUpdate({ user_id: interaction.user.id }, { $inc: { deliver_count_week: 1, deliver_count_total: 1 } }, { upsert: true });
                updateMasterLog(oid);
                
                await interaction.reply({ embeds: [createEmbed("✅ Delivery Started", "Check your DMs for the invite link and script!", SUCCESS_COLOR)], ephemeral: true });
            } catch (err) {
                await interaction.reply({ embeds: [createEmbed("❌ DM Failed", "Please open your DMs so I can send you the invite.", ERROR_COLOR)], ephemeral: true });
            }
        } else {
            if(channel) {
                const embed = createEmbed("🚴 Order Delivered", `**Chef:** ${order.chef_name}\n**Driver:** ${interaction.user.username}\n\n**Message:**\n${script}`, BRAND_COLOR);
                if(order.images && order.images.length > 0) embed.setImage(order.images[0]);
                
                await channel.send({ content: `<@${order.user_id}>`, embeds: [embed] });
                if(order.images.length > 1) await channel.send({ files: order.images.slice(1) });

                order.status = 'delivered'; 
                order.deliverer_id = interaction.user.id;
                await order.save();
                
                await User.findOneAndUpdate({ user_id: interaction.user.id }, { $inc: { deliver_count_week: 1, deliver_count_total: 1 } }, { upsert: true });
                updateMasterLog(oid);
                
                await interaction.reply({ embeds: [createEmbed("⚠️ Invite Failed", "I couldn't create an invite, so I delivered the order for you.", BRAND_COLOR)], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [createEmbed("❌ Delivery Failed", "Could not reach the customer's channel.", ERROR_COLOR)], ephemeral: true });
            }
        }
    }

    // --- QUOTA ---
    if (commandName === 'quota') {
        if (!perms.isStaff) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Staff only.", ERROR_COLOR)], ephemeral: true });
        
        const guild = interaction.guild;
        const cookRole = guild.roles.cache.get(ROLES.COOK);
        const delRole = guild.roles.cache.get(ROLES.DELIVERY);
        await guild.members.fetch(); 
        const cooks = cookRole ? cookRole.members.size : 1;
        const deliverers = delRole ? delRole.members.size : 1;

        const allUsers = await User.find({});
        let totalCook = 0; let totalDel = 0;
        allUsers.forEach(u => { totalCook += u.cook_count_week; totalDel += u.deliver_count_week; });

        const cTarget = calculateTargets(totalCook, cooks);
        const dTarget = calculateTargets(totalDel, deliverers);

        const u = await User.findOne({ user_id: interaction.user.id }) || {};
        
        let desc = "";
        if (perms.isCook) {
            const target = cTarget.norm; 
            const status = (u.cook_count_week >= target) ? "✅ On Track" : "⚠️ Behind";
            desc += `👨‍🍳 **Cooking:** ${u.cook_count_week || 0} / ${target} (${status})\n`;
        }
        if (perms.isDelivery) {
            const target = dTarget.norm;
            const status = (u.deliver_count_week >= target) ? "✅ On Track" : "⚠️ Behind";
            desc += `🚴 **Delivery:** ${u.deliver_count_week || 0} / ${target} (${status})\n`;
        }
        
        await interaction.reply({ embeds: [createEmbed("📊 Your Quota Status", desc, BRAND_COLOR)], ephemeral: true });
    }

    // --- STATS ---
    if (commandName === 'stats') {
        if (!perms.isStaff) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Staff only.", ERROR_COLOR)], ephemeral: true });
        const target = interaction.options.getUser('user') || interaction.user;
        const u = await User.findOne({ user_id: target.id }) || {};
        const ratedOrders = await Order.find({ deliverer_id: target.id, rating: { $exists: true } });
        let avgRating = "N/A";
        if (ratedOrders.length > 0) {
            const sum = ratedOrders.reduce((a, b) => a + b.rating, 0);
            avgRating = (sum / ratedOrders.length).toFixed(1) + " ⭐";
        }
        const embed = createEmbed(`📈 Stats: ${target.username}`, "", 0x9B59B6, [
            { name: "👨‍🍳 Cooking", value: `**Weekly:** ${u.cook_count_week || 0}\n**Lifetime:** ${u.cook_count_total || 0}`, inline: true },
            { name: "🚴 Delivery", value: `**Weekly:** ${u.deliver_count_week || 0}\n**Lifetime:** ${u.deliver_count_total || 0}`, inline: true },
            { name: "⭐ Avg Rating", value: avgRating, inline: false }
        ]).setThumbnail(target.displayAvatarURL());
        
        await interaction.reply({ embeds: [embed] });
    }

    // --- RATE ---
    if (commandName === 'rate') {
        const oid = interaction.options.getString('id');
        const stars = interaction.options.getInteger('stars');
        const order = await Order.findOne({ order_id: oid, user_id: interaction.user.id });
        if(!order || order.status !== 'delivered') return interaction.reply({ embeds: [createEmbed("❌ Invalid Order", "Order must be delivered before rating.", ERROR_COLOR)], ephemeral: true });
        order.rating = stars; await order.save(); updateMasterLog(oid);
        const chan = client.channels.cache.get(CHANNELS.RATINGS);
        if(chan) {
            const embed = createEmbed("⭐ New Rating!", `**Order:** \`${oid}\`\n**Rating:** ${"⭐".repeat(stars)}\n**Chef:** ${order.chef_name}\n**Deliverer:** <@${order.deliverer_id}>`, 0xF1C40F);
            chan.send({ embeds: [embed] });
        }
        await interaction.reply({ embeds: [createEmbed("✅ Rated", "Thank you for your feedback!", SUCCESS_COLOR)], ephemeral: true });
    }

    if (commandName === 'invite') {
        const link = client.generateInvite({ 
            scopes: ['bot', 'applications.commands'], 
            permissions: [
                PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.UseExternalEmojis, PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.CreateInstantInvite
            ] 
        });
        const embed = createEmbed("🔗 Invite Sugar Rush", "Click the button below to invite me to your server!", BRAND_COLOR);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Invite Me").setStyle(ButtonStyle.Link).setURL(link));
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (commandName === 'generate_codes') {
        if(interaction.user.id !== ROLES.OWNER) return interaction.reply({ embeds: [createEmbed("❌ Owner Only", "You cannot use this.", ERROR_COLOR)], ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        let txt = ""; for(let i=0; i<amount; i++) { const c = generateCode(); await new PremiumCode({ code: c, created_by: interaction.user.id }).save(); txt += c + "\n"; }
        await interaction.reply({ embeds: [createEmbed("✅ Codes Generated", `Generated ${amount} codes. Check file.`, SUCCESS_COLOR)], files: [{ attachment: Buffer.from(txt), name: 'codes.txt' }], ephemeral: true });
    }

    if (commandName === 'redeem') {
        const code = interaction.options.getString('code');
        const valid = await PremiumCode.findOneAndUpdate({ code: code, status: 'unused' }, { status: 'redeemed' });
        if(!valid) return interaction.reply({ embeds: [createEmbed("❌ Invalid Code", "Code is invalid or already used.", ERROR_COLOR)], ephemeral: true });
        await PremiumUser.findOneAndUpdate({ user_id: interaction.user.id }, { is_vip: true, expires_at: new Date(Date.now() + 30*24*60*60*1000) }, { upsert: true });
        try { (await client.guilds.cache.get(SUPPORT_SERVER_ID).members.fetch(interaction.user.id)).roles.add(ROLES.VIP); } catch(e){}
        await interaction.reply({ embeds: [createEmbed("💎 VIP Activated", "You now have 30 days of VIP benefits!", 0x9B59B6)], ephemeral: true });
    }

    if (commandName === 'addvip') {
        if(interaction.user.id !== ROLES.OWNER) return interaction.reply({ embeds: [createEmbed("❌ Owner Only", "You cannot use this.", ERROR_COLOR)], ephemeral: true });
        const target = interaction.options.getUser('user');
        await PremiumUser.findOneAndUpdate({ user_id: target.id }, { is_vip: true, expires_at: new Date(Date.now() + 30*24*60*60*1000) }, { upsert: true });
        try { (await client.guilds.cache.get(SUPPORT_SERVER_ID).members.fetch(target.id)).roles.add(ROLES.VIP); } catch(e){}
        await interaction.reply({ embeds: [createEmbed("💎 VIP Gifted", `${target.username} has been given VIP status.`, SUCCESS_COLOR)] });
    }

    if (commandName === 'removevip') {
        if(interaction.user.id !== ROLES.OWNER) return interaction.reply({ embeds: [createEmbed("❌ Owner Only", "You cannot use this.", ERROR_COLOR)], ephemeral: true });
        const target = interaction.options.getUser('user');
        await PremiumUser.findOneAndUpdate({ user_id: target.id }, { is_vip: false, expires_at: null });
        try { (await client.guilds.cache.get(SUPPORT_SERVER_ID).members.fetch(target.id)).roles.remove(ROLES.VIP); } catch(e){}
        await interaction.reply({ embeds: [createEmbed("📉 VIP Removed", `${target.username} lost VIP status.`, SUCCESS_COLOR)] });
    }

    if (commandName === 'orderlist') {
        const active = await Order.find({ status: { $in: ['pending', 'claimed', 'cooking', 'ready'] } }).sort({ is_vip: -1, created_at: 1 });
        let desc = ""; if (active.length === 0) desc = "Queue is currently empty.";
        active.forEach(o => { const vip = o.is_vip ? "💎 " : ""; desc += `${vip}\`${o.order_id}\`: **${o.status.toUpperCase()}** (${o.item})\n`; });
        await interaction.reply({ embeds: [createEmbed("🍩 Active Queue", desc.substring(0, 4000), BRAND_COLOR)], ephemeral: true });
    }

    if (commandName === 'unclaim') {
        const oid = interaction.options.getString('id');
        const order = await Order.findOne({ order_id: oid });
        if(!order || order.status !== 'claimed') return interaction.reply({ embeds: [createEmbed("❌ Error", "Order not claimed.", ERROR_COLOR)], ephemeral: true });
        if(order.chef_name !== interaction.user.username && !perms.isManager) return interaction.reply({ embeds: [createEmbed("❌ Error", "You did not claim this order.", ERROR_COLOR)], ephemeral: true });
        order.status = 'pending'; order.chef_name = null; await order.save(); updateMasterLog(oid); 
        await interaction.reply({ embeds: [createEmbed("🔓 Unclaimed", `Order \`${oid}\` has been released.`, SUCCESS_COLOR)] });
    }

    if (commandName === 'warn' || commandName === 'fdo') {
        if(!perms.isManager) return interaction.reply({ embeds: [createEmbed("❌ Access Denied", "Managers only.", ERROR_COLOR)], ephemeral: true });
        const oid = interaction.options.getString('id'); const reason = interaction.options.getString('reason');
        const order = await Order.findOne({ order_id: oid }); if(!order) return interaction.reply({ embeds: [createEmbed("❌ Error", "Invalid ID.", ERROR_COLOR)], ephemeral: true });
        order.status = commandName === 'fdo' ? 'cancelled_fdo' : 'cancelled_warn'; await order.save(); updateMasterLog(oid);
        const u = await User.findOneAndUpdate({ user_id: order.user_id }, { $inc: { warnings: 1 } }, { new: true, upsert: true });
        if(u.warnings >= 3) { u.is_banned = 1; await u.save(); }
        
        const chan = client.channels.cache.get(CHANNELS.WARNING);
        if(chan) chan.send({ embeds: [createEmbed("⚠️ User Warned", `**User:** <@${order.user_id}>\n**Reason:** ${reason}\n**Strikes:** ${u.warnings}`, ERROR_COLOR)] });
        await interaction.reply({ embeds: [createEmbed("✅ Action Taken", `User warned. Total strikes: ${u.warnings}`, SUCCESS_COLOR)] });
    }

    if (commandName === 'runquota') {
        if(!perms.isManager) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Managers only.", ERROR_COLOR)], ephemeral: true });
        await interaction.deferReply({ ephemeral: true }); await runQuotaLogic(interaction.guild); 
        await interaction.editReply({ embeds: [createEmbed("✅ Quota Run", "Weekly quota check forced successfully.", SUCCESS_COLOR)] });
    }

    if (commandName === 'rules') {
        const embed = createEmbed(`${BRAND_NAME} Rules`, "", BRAND_COLOR, [
            { name: "1. The Golden Rule", value: "**Every order MUST include a donut.**" },
            { name: "2. Conduct", value: "No NSFW content in orders or images." },
            { name: "3. Queue", value: "One active order at a time per user." },
            { name: "4. Max Items", value: "Maximum 3 items per order." }
        ]);
        await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'complain') {
        const oid = interaction.options.getString('id'); const reason = interaction.options.getString('reason');
        const order = await Order.findOne({ order_id: oid }); if(!order) return interaction.reply({ embeds: [createEmbed("❌ Error", "Invalid Order ID.", ERROR_COLOR)], ephemeral: true });
        const chan = client.channels.cache.get(CHANNELS.COMPLAINT); 
        if(chan) chan.send({ embeds: [createEmbed("🚨 New Complaint", `**Order:** \`${oid}\`\n**User:** <@${interaction.user.id}>\n**Reason:** ${reason}`, ERROR_COLOR)] });
        await interaction.reply({ embeds: [createEmbed("✅ Sent", "Your complaint has been sent to management.", SUCCESS_COLOR)], ephemeral: true });
    }

    if (commandName === 'unban') {
        if(!perms.isManager) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Managers only.", ERROR_COLOR)], ephemeral: true });
        const target = interaction.options.getUser('user');
        await User.findOneAndUpdate({ user_id: target.id }, { is_banned: 0, warnings: 0 });
        await interaction.reply({ embeds: [createEmbed("✅ Unbanned", `${target.username} is no longer banned.`, SUCCESS_COLOR)] });
    }

    if (commandName === 'vacation') {
        if (!perms.isStaff) return interaction.reply({ embeds: [createEmbed("❌ Denied", "Staff only.", ERROR_COLOR)], ephemeral: true });
        const days = interaction.options.getInteger('days'); const reason = interaction.options.getString('reason');
        if (days < 1 || days > 14) return interaction.reply({ embeds: [createEmbed("❌ Error", "Days must be 1-14.", ERROR_COLOR)], ephemeral: true });
        
        const channel = client.channels.cache.get(CHANNELS.VACATION);
        if(channel) {
            const embed = createEmbed("🌴 Vacation Request", `**Staff:** <@${interaction.user.id}>\n**Duration:** ${days} Days\n**Reason:** ${reason}`, 0x1ABC9C);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vacApprove_${interaction.user.id}_${days}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`vacEdit_${interaction.user.id}`).setLabel('Edit Duration').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`vacDeny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
            );
            channel.send({ embeds: [embed], components: [row] });
        }
        await interaction.reply({ embeds: [createEmbed("✅ Request Sent", "Management will review your request.", SUCCESS_COLOR)] });
    }
});

client.login(BOT_TOKEN);
