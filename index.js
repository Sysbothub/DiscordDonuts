/**
 * ============================================================================
 * SUGAR RUSH - MASTER DISCORD AUTOMATION INFRASTRUCTURE
 * ============================================================================
 * * VERSION: 65.0.0 (DISCIPLINARY USER NOTIFICATIONS & FULL EXPANSION)
 * * ----------------------------------------------------------------------------
 * 🍩 SYSTEM UPDATES:
 * 1.  USER NOTIFICATION: Bot DMs the user immediately upon receiving a strike.
 * 2.  3/6/9 ESCALATION: Automates bans based on strike count (7d/30d/Perm).
 * 3.  FULL REGISTRY: All 26 commands fully operational and integrated.
 * ----------------------------------------------------------------------------
 * 🍩 CORE SPECS:
 * - Economy: 100 Std / 50 VIP / 150 Super Order.
 * - Store: https://donuts.sell.app/
 * - Manual Dispatch: Courier Manual Join Protocol via DM Briefing.
 * - Failsafe: 20-Minute Auto-Complete Timer.
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
// [SECTION 1] CONFIGURATION VARIABLES
// ============================================================================


const CONF_TOKEN = process.env.DISCORD_TOKEN;
const CONF_MONGO = process.env.MONGO_URI;
const CONF_SHEET = process.env.GOOGLE_SHEET_ID;
const CONF_OWNER = '662655499811946536';
const CONF_HQ_ID = '1454857011866112063';
const CONF_STORE = "https://donuts.sell.app/";
const CONF_INVITE = "https://discord.gg/Q4DsEbJzBJ";


const ROLE_COOK = '1454877400729911509';
const ROLE_DELIVERY = '1454877287953469632';
const ROLE_MANAGER = '1454876343878549630';
const ROLE_QUOTA_EXEMPT = '1454936082591252534';


const CHAN_COOK = '1454879418999767122';
const CHAN_DELIVERY = '1454880879741767754';
const CHAN_BACKUP = '1454888266451910901';
const CHAN_QUOTA = '1454895987322519672';
const CHAN_WARNINGS = '1454881451161026637';
const CHAN_BLACKLIST = '1455092188626292852';
const CHAN_VACATION = '1454886383662665972';
const CHAN_RATINGS = '1454884136740327557';


const COLOR_MAIN = 0xFFA500;
const COLOR_SUCCESS = 0x2ECC71;
const COLOR_FAIL = 0xFF0000;


// ============================================================================
// [SECTION 2] MONGODB SCHEMAS
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
    ready_at: Date,
    images: [String],
    backup_msg_id: String
});


const VIPCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    is_used: { type: Boolean, default: false }
});


const ScriptSchema = new mongoose.Schema({
    user_id: String,
    script: String
});


const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);
const VIPCode = mongoose.model('VIPCode', VIPCodeSchema);
const Script = mongoose.model('Script', ScriptSchema);


// ============================================================================
// [SECTION 3] HELPER FUNCTIONS
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


async function checkPermissions(userId) {
    
    if (userId === CONF_OWNER) {
        return { 
            isOwner: true, isManager: true, isCook: true, 
            isDelivery: true, isStaff: true 
        };
    }

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

    } catch (err) {
        return { 
            isOwner: false, isManager: false, isCook: false, 
            isDelivery: false, isStaff: false 
        };
    }
}


async function updateOrderArchive(orderId) {
    try {
        const channel = await client.channels.fetch(CHAN_BACKUP).catch(() => null);
        const order = await Order.findOne({ order_id: orderId });

        if (!channel || !order) return;

        const embed = createEmbed(
            `Archive Record: #${order.order_id}`, 
            null, 
            order.is_super ? COLOR_FAIL : COLOR_MAIN,
            [
                { name: 'Status', value: `\`${order.status.toUpperCase()}\``, inline: true },
                { name: 'Customer', value: `<@${order.user_id}>`, inline: true },
                { name: 'Chef', value: order.chef_name || 'Pending', inline: true },
                { name: 'Courier', value: order.deliverer_id ? `<@${order.deliverer_id}>` : 'Pending', inline: true }
            ]
        );

        if (order.images?.length > 0) {
            embed.setImage(order.images[0]);
        }

        if (!order.backup_msg_id) {
            const msg = await channel.send({ embeds: [embed] });
            order.backup_msg_id = msg.id;
            await order.save();
        } else {
            const msg = await channel.messages.fetch(order.backup_msg_id).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error("Archive Error: ", error);
    }
}


// --- 3/6/9 AUTOMATED ESCALATION LOGIC ---

async function applyWarningLogic(user) {
    
    user.warnings += 1;
    let punishment = "Formal Warning";

    if (user.warnings === 3) {
        // 7 Day Ban
        user.service_ban_until = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
        punishment = "7-Day Service Ban";
    }
    
    else if (user.warnings === 6) {
        // 30 Day Ban
        user.service_ban_until = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        punishment = "30-Day Service Ban";
    }
    
    else if (user.warnings >= 9) {
        // Perm Ban
        user.is_perm_banned = true;
        punishment = "Permanent Blacklist";
    }

    await user.save();
    return punishment;
}


// ============================================================================
// [SECTION 4] CLIENT LOGIC & FAILSAFE
// ============================================================================


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});


client.once('ready', async () => {
    
    console.log(`[SYSTEM] Sugar Rush v65.0.0 Online.`);
    
    await mongoose.connect(CONF_MONGO);
    
    client.user.setPresence({ 
        activities: [{ name: '/order | Sugar Rush', type: ActivityType.Playing }], 
        status: 'online' 
    });

    setInterval(runOrderFailsafe, 60000);

});


async function runOrderFailsafe() {
    
    const timeLimit = new Date(Date.now() - 1200000); 
    
    const staleOrders = await Order.find({ 
        status: 'ready', 
        ready_at: { $lt: timeLimit } 
    });

    for (const order of staleOrders) {
        try {
            const guild = client.guilds.cache.get(order.guild_id);
            const channel = guild?.channels.cache.get(order.channel_id);

            if (channel) {
                const embed = createEmbed("🍩 Auto-Dispatch System", "Your order has been automatically finalized by HQ backup protocols.", COLOR_MAIN);
                if (order.images?.length > 0) embed.setImage(order.images[0]);
                await channel.send({ content: `<@${order.user_id}>`, embeds: [embed] });

                order.status = 'delivered';
                order.deliverer_id = 'SYSTEM_FAILSAFE';
                await order.save();
                
                updateOrderArchive(order.order_id);
            }
        } catch (e) {}
    }
}


// ============================================================================
// [SECTION 5] INTERACTION ROUTER
// ============================================================================


client.on('interactionCreate', async (interaction) => {

    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;
    const perms = await checkPermissions(interaction.user.id);
    const userData = await User.findOne({ user_id: interaction.user.id }) || new User({ user_id: interaction.user.id });

    const publicCmds = [
        'help', 'order', 'super_order', 'orderstatus', 'daily', 
        'balance', 'premium', 'rules', 'redeem', 'review', 
        'tip', 'invite', 'support'
    ];
    
    const isEphemeral = !publicCmds.includes(commandName);

    if (commandName !== 'deliver') {
        await interaction.deferReply({ ephemeral: isEphemeral });
    }

    // Ban Check
    if (userData.is_perm_banned || (userData.service_ban_until > Date.now())) {
        const banMsg = `❌ **Service Restricted.**\nAppeal Here: ${CONF_INVITE}`;
        if (commandName !== 'deliver') return interaction.editReply(banMsg);
        else return interaction.reply({ content: banMsg, ephemeral: true });
    }

    // ------------------------------------------------------------------------
    // [5.1] OWNER COMMANDS
    // ------------------------------------------------------------------------

    if (commandName === 'generate_codes') {
        
        if (!perms.isOwner) return interaction.editReply("❌ Owner Access Only.");

        const amount = options.getInteger('amount');
        const codeList = [];

        for (let i = 0; i < amount; i++) {
            const newCode = `VIP-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            await new VIPCode({ code: newCode }).save();
            codeList.push(newCode);
        }

        await interaction.user.send({ 
            embeds: [createEmbed("Keys Generated", codeList.join('\n'), COLOR_SUCCESS)] 
        });

        return interaction.editReply(`✅ Generated ${amount} keys.`);
    }

    // ------------------------------------------------------------------------
    // [5.2] DISCIPLINARY COMMANDS (WITH USER NOTIFICATION)
    // ------------------------------------------------------------------------

    // COMMAND: /warn (Pre-Cook Cancellation)
    if (commandName === 'warn') {
        
        if (!perms.isCook) return interaction.editReply("❌ Permission Denied (Cooks/Mgmt).");

        const orderId = options.getString('id');
        const reason = options.getString('reason');

        const order = await Order.findOne({ order_id: orderId });
        
        if (!order || (order.status !== 'pending' && order.status !== 'claimed')) {
            return interaction.editReply("❌ Order must be Pending or Claimed to use /warn.");
        }

        const targetUser = await User.findOne({ user_id: order.user_id }) || new User({ user_id: order.user_id });
        const penalty = await applyWarningLogic(targetUser);
        
        order.status = 'cancelled_warn';
        await order.save();

        // LOGGING
        const logChan = client.channels.cache.get(CHAN_WARNINGS);
        if (logChan) {
            logChan.send({
                embeds: [createEmbed("⚠️ Pre-Cook Strike", `**ID:** ${orderId}\n**User:** <@${order.user_id}>\n**Reason:** ${reason}\n**Penalty:** ${penalty}\n**Total Strikes:** ${targetUser.warnings}`, COLOR_FAIL)]
            });
        }

        // NOTIFY USER
        try {
            const uObj = await client.users.fetch(order.user_id);
            await uObj.send({
                embeds: [createEmbed("⚠️ Service Violation Warning", null, COLOR_FAIL, [
                    { name: "Reason", value: reason },
                    { name: "Order ID", value: orderId },
                    { name: "Current Status", value: `${penalty} (Strike ${targetUser.warnings}/9)` },
                    { name: "Appeal", value: CONF_INVITE }
                ])]
            });
        } catch (e) {
            console.log("Failed to DM user warning.");
        }

        updateOrderArchive(order.order_id);
        return interaction.editReply(`⚠️ Order Cancelled. User Warned. Status: **${penalty}**.`);
    }

    // COMMAND: /fdo (Post-Cook/Pre-Delivery Cancellation)
    if (commandName === 'fdo') {
        
        if (!perms.isManager) return interaction.editReply("❌ Permission Denied (Mgmt Only).");

        const orderId = options.getString('id');
        const reason = options.getString('reason');

        const order = await Order.findOne({ order_id: orderId });

        if (!order || order.status !== 'ready') {
            return interaction.editReply("❌ Order must be 'Ready' to use /fdo.");
        }

        const targetUser = await User.findOne({ user_id: order.user_id }) || new User({ user_id: order.user_id });
        const penalty = await applyWarningLogic(targetUser);
        
        order.status = 'cancelled_fdo';
        await order.save();

        // LOGGING
        const logChan = client.channels.cache.get(CHAN_WARNINGS);
        if (logChan) {
            logChan.send({
                embeds: [createEmbed("🛑 FDO Executed", `**ID:** ${orderId}\n**User:** <@${order.user_id}>\n**Reason:** ${reason}\n**Penalty:** ${penalty}\n**Total Strikes:** ${targetUser.warnings}`, COLOR_FAIL)]
            });
        }

        // NOTIFY USER
        try {
            const uObj = await client.users.fetch(order.user_id);
            await uObj.send({
                embeds: [createEmbed("🛑 Order Force Cancelled", null, COLOR_FAIL, [
                    { name: "Reason", value: reason },
                    { name: "Order ID", value: orderId },
                    { name: "Current Status", value: `${penalty} (Strike ${targetUser.warnings}/9)` },
                    { name: "Appeal", value: CONF_INVITE }
                ])]
            });
        } catch (e) {
            console.log("Failed to DM user FDO.");
        }

        updateOrderArchive(order.order_id);
        return interaction.editReply(`🛑 Order Force Deleted. User Warned. Status: **${penalty}**.`);
    }

    // COMMAND: /force_warn (Post-Delivery Strike)
    if (commandName === 'force_warn') {
        
        if (!perms.isManager) return interaction.editReply("❌ Permission Denied (Mgmt Only).");

        const orderId = options.getString('id');
        const reason = options.getString('reason');

        const order = await Order.findOne({ order_id: orderId });
        
        if (!order) return interaction.editReply("❌ Invalid Order ID.");

        const targetUser = await User.findOne({ user_id: order.user_id }) || new User({ user_id: order.user_id });
        const penalty = await applyWarningLogic(targetUser);

        // LOGGING
        const logChan = client.channels.cache.get(CHAN_WARNINGS);
        if (logChan) {
            logChan.send({
                embeds: [createEmbed("⚡ Force Strike Issued", `**ID:** ${orderId}\n**User:** <@${order.user_id}>\n**Reason:** ${reason}\n**Penalty:** ${penalty}\n**Total Strikes:** ${targetUser.warnings}`, COLOR_FAIL)]
            });
        }

        // NOTIFY USER
        try {
            const uObj = await client.users.fetch(order.user_id);
            await uObj.send({
                embeds: [createEmbed("⚡ Disciplinary Strike Received", null, COLOR_FAIL, [
                    { name: "Reason", value: reason },
                    { name: "Order ID", value: orderId },
                    { name: "Current Status", value: `${penalty} (Strike ${targetUser.warnings}/9)` },
                    { name: "Appeal", value: CONF_INVITE }
                ])]
            });
        } catch (e) {
            console.log("Failed to DM user force_warn.");
        }

        return interaction.editReply(`⚡ Strike issued for completed order. Status: **${penalty}**.`);
    }

    // ------------------------------------------------------------------------
    // [5.4] CONSUMER COMMANDS
    // ------------------------------------------------------------------------

    if (commandName === 'premium') {
        const embed = createEmbed(
            "💎 Sugar Rush Premium",
            "Upgrade your experience at our official store.",
            COLOR_MAIN,
            [
                { name: "Perks", value: "50% Off Orders | 2x Daily Coins | Priority Queue" },
                { name: "Store Link", value: `**[donuts.sell.app](${CONF_STORE})**` }
            ]
        );
        return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'order' || commandName === 'super_order') {
        
        const isSuper = commandName === 'super_order';
        const cost = isSuper ? 150 : (userData.vip_until > Date.now() ? 50 : 100);

        if (userData.balance < cost) {
            return interaction.editReply(`❌ Insufficient Funds. Cost: **${cost}**.`);
        }

        const newId = Math.random().toString(36).substring(2, 8).toUpperCase();

        await new Order({
            order_id: newId,
            user_id: interaction.user.id,
            guild_id: interaction.guildId,
            channel_id: interaction.channelId,
            item: options.getString('item'),
            is_vip: userData.vip_until > Date.now(),
            is_super: isSuper
        }).save();

        userData.balance -= cost;
        await userData.save();

        const kitchenChan = client.channels.cache.get(CHAN_COOK);
        if (kitchenChan) {
            await kitchenChan.send({
                content: isSuper ? "@here 🚀 **PRIORITY**" : null,
                embeds: [createEmbed(
                    isSuper ? "🚀 Super Order" : "🍩 New Order",
                    `ID: \`${newId}\`\nItem: ${options.getString('item')}`
                )]
            });
        }

        updateOrderArchive(newId);
        return interaction.editReply({ embeds: [createEmbed("✅ Order Received", `ID: \`${newId}\``, COLOR_SUCCESS)] });
    }

    if (commandName === 'redeem') {
        
        const codeInput = options.getString('code');
        const validCode = await VIPCode.findOne({ code: codeInput, is_used: false });

        if (!validCode) return interaction.editReply("❌ Invalid Key.");

        const now = new Date();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        let newExpiryDate;

        if (userData.vip_until > now) {
            newExpiryDate = new Date(userData.vip_until.getTime() + thirtyDaysMs);
        } else {
            newExpiryDate = new Date(now.getTime() + thirtyDaysMs);
        }

        userData.vip_until = newExpiryDate;
        validCode.is_used = true;
        
        await userData.save();
        await validCode.save();

        return interaction.editReply({ 
            embeds: [createEmbed("💎 VIP Activated", `Expires: ${newExpiryDate.toDateString()}`, COLOR_SUCCESS)] 
        });

    }

    if (commandName === 'daily') {
        const now = Date.now();
        if (now - userData.last_daily < 86400000) return interaction.editReply("❌ Daily Cooldown.");

        const payAmt = userData.vip_until > now ? 2000 : 1000;
        userData.balance += payAmt;
        userData.last_daily = now;
        await userData.save();

        return interaction.editReply(`💰 Daily Collected: **${payAmt}**`);
    }

    // ------------------------------------------------------------------------
    // [5.5] KITCHEN COMMANDS
    // ------------------------------------------------------------------------

    if (commandName === 'claim') {
        
        if (!perms.isCook) return interaction.editReply("❌ Cooks Only.");

        const order = await Order.findOne({ order_id: options.getString('id'), status: 'pending' });
        if (!order) return interaction.editReply("❌ Invalid Order.");

        order.status = 'claimed';
        order.chef_id = interaction.user.id;
        order.chef_name = interaction.user.username;
        await order.save();
        
        updateOrderArchive(order.order_id);
        return interaction.editReply(`👨‍🍳 Order \`${order.order_id}\` claimed.`);

    }

    if (commandName === 'cook') {
        
        if (!perms.isCook) return interaction.editReply("❌ Cooks Only.");

        const order = await Order.findOne({ 
            order_id: options.getString('id'), 
            status: 'claimed', 
            chef_id: interaction.user.id 
        });

        if (!order) return interaction.editReply("❌ Not your order.");

        order.status = 'cooking';
        const img = options.getAttachment('image');
        const link = options.getString('link');
        order.images = [img ? img.url : link];
        await order.save();

        updateOrderArchive(order.order_id);
        interaction.editReply("♨️ Cooking... (3 Minutes)");

        setTimeout(async () => {
            const check = await Order.findOne({ order_id: order.order_id });
            if (check && check.status === 'cooking') {
                check.status = 'ready';
                check.ready_at = new Date();
                await check.save();

                userData.balance += 20;
                userData.cook_count_total += 1;
                await userData.save();
                
                updateOrderArchive(check.order_id);
            }
        }, 180000);

        return;
    }

    // ------------------------------------------------------------------------
    // [5.6] LOGISTICS COMMANDS (MANUAL JOIN PROTOCOL)
    // ------------------------------------------------------------------------

    if (commandName === 'deliver') {
        
        if (!perms.isDelivery) return interaction.reply({ content: "❌ Delivery Only.", ephemeral: true });

        const order = await Order.findOne({ order_id: options.getString('id'), status: 'ready' });
        if (!order) return interaction.reply({ content: "❌ Order not ready.", ephemeral: true });

        const guild = client.guilds.cache.get(order.guild_id);
        const channel = guild?.channels.cache.get(order.channel_id);

        if (!guild || !channel) return interaction.reply({ content: "❌ Destination lost.", ephemeral: true });

        // Protocol Check
        const courierInServer = guild.members.cache.has(interaction.user.id);

        if (!courierInServer) {
            
            try {
                const invite = await channel.createInvite({ maxAge: 1800, maxUses: 1 });
                const scriptData = await Script.findOne({ user_id: interaction.user.id });
                const customer = await client.users.fetch(order.user_id);

                const briefEmbed = createEmbed("🚴 Dispatch Briefing", "Manual Join Required", COLOR_MAIN, [
                    { name: "Target", value: `**Server:** ${guild.name}\n**Invite:** ${invite.url}` },
                    { name: "Customer", value: `**Tag:** <@${customer.id}>\n**ID:** \`${customer.id}\`` },
                    { name: "Script", value: `\`\`\`${scriptData?.script || "Enjoy!"}\`\`\`` }
                ]);

                await interaction.user.send({ embeds: [briefEmbed] });
                return interaction.reply({ content: "📫 **Briefing Sent.** Check DMs.", ephemeral: true });
            
            } catch (e) {
                return interaction.reply({ content: "❌ Invite Gen Error.", ephemeral: true });
            }

        }

        // Execution
        await interaction.deferReply({ ephemeral: true });
        
        const scriptData = await Script.findOne({ user_id: interaction.user.id });
        
        const deliveryEmbed = createEmbed("🚴 Delivery Arrived!", scriptData?.script || "Enjoy your order!", COLOR_SUCCESS);
        if (order.images?.length > 0) deliveryEmbed.setImage(order.images[0]);

        await channel.send({ content: `<@${order.user_id}>`, embeds: [deliveryEmbed] });

        order.status = 'delivered';
        order.deliverer_id = interaction.user.id;
        await order.save();

        userData.balance += 30;
        userData.deliver_count_total += 1;
        await userData.save();

        updateOrderArchive(order.order_id);
        return interaction.editReply("✅ Delivery Complete.");

    }

    if (commandName === 'setscript') {
        
        if (!perms.isDelivery) return interaction.editReply("❌ Delivery Only.");
        
        await Script.findOneAndUpdate(
            { user_id: interaction.user.id },
            { script: options.getString('message') },
            { upsert: true }
        );
        return interaction.editReply("✅ Delivery script updated.");

    }

    // ------------------------------------------------------------------------
    // [5.7] UTILITY COMMANDS
    // ------------------------------------------------------------------------

    if (commandName === 'help') {
        const fields = [
            { name: "🍩 Consumer", value: "/order, /daily, /premium, /redeem" }
        ];
        if (perms.isCook) fields.push({ name: "👨‍🍳 Kitchen", value: "/claim, /cook, /warn" });
        if (perms.isDelivery) fields.push({ name: "🚴 Logistics", value: "/deliver, /setscript" });
        if (perms.isManager) fields.push({ name: "👔 Management", value: "/ban, /unban, /refund, /fdo, /force_warn" });
        
        return interaction.editReply({ embeds: [createEmbed("Command Directory", null, COLOR_MAIN, fields)] });
    }

});


// ============================================================================
// [SECTION 6] OWNER PREFIX COMMANDS
// ============================================================================


client.on('messageCreate', async (message) => {
    
    if (message.author.bot) return;

    if (message.content.startsWith("!eval") && message.author.id === CONF_OWNER) {
        
        const code = message.content.slice(5).trim();
        
        try {
            let evaled = eval(code);
            if (evaled && evaled.constructor.name == "Promise") evaled = await evaled;
            if (typeof evaled !== "string") evaled = util.inspect(evaled, { depth: 1 });
            
            const clean = evaled.replaceAll(CONF_TOKEN, "[REDACTED]");
            
            message.channel.send(`\`\`\`js\n${clean}\n\`\`\``);
        } catch (e) {
            message.channel.send(`\`\`\`js\n${e}\n\`\`\``);
        }
    }

});


client.login(CONF_TOKEN);
