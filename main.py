import discord
from discord.ext import commands, tasks
import asyncio
import uuid
import datetime
import os
import aiohttp
import math
import random
import string
import io
from pymongo import MongoClient, ReturnDocument

# --- 1. CONFIGURATION ---

# Environment Variables
BOT_TOKEN = os.environ.get("DISCORD_TOKEN")
MONGO_URI = os.environ.get("MONGO_URI")

# --- BRANDING ---
BRAND_NAME = "Sugar Rush"
BRAND_COLOR = discord.Color.orange()
SUPPORT_EMAIL = "help@sugarrush.gg"
SUPPORT_SERVER_LINK = "https://discord.gg/ceT3Gqwquj"

# --- ROLE IDs ---
COOK_ROLE_ID = 1454877400729911509
DELIVERY_ROLE_ID = 1454877287953469632
MANAGER_ROLE_ID = 1454876343878549630
OWNER_ID = 662655499811946536

# Senior Staff & Bypass
SENIOR_COOK_ROLE_ID = 0
SENIOR_DELIVERY_ROLE_ID = 0
QUOTA_BYPASS_ROLE_ID = 1454936082591252534

# Support Server VIP
SUPPORT_SERVER_ID = 1454857011866112063
VIP_ROLE_ID = 1454935878408605748

# --- CHANNEL IDs ---
COOK_CHANNEL_ID = 1454879418999767122       # Kitchen
DELIVERY_CHANNEL_ID = 1454880879741767754   # Counter
WARNING_CHANNEL_ID = 1454881451161026637    # Moderation Logs
RATINGS_CHANNEL_ID = 1454884136740327557    # Star Ratings
COMPLAINT_CHANNEL_ID = 1454886383662665972  # User Complaints
BACKUP_CHANNEL_ID = 1454888266451910901     # Master Log
QUOTA_CHANNEL_ID = 1454895987322519672      # Quota Reports
VACATION_CHANNEL_ID = 1454909580894015754   # Vacation Requests

# --- 2. DATABASE CONNECTION ---
try:
    # tz_aware=True forces MongoDB to return Timezone Aware dates
    cluster = MongoClient(MONGO_URI, tz_aware=True)
    db = cluster["patisserie_db"]
    orders_col = db["orders"]
    users_col = db["users"]
    scripts_col = db["scripts"]
    premium_col = db["premium_users"]
    vacations_col = db["vacations"]
    codes_col = db["premium_codes"] 
    config_col = db["config"] 
    print("✅ Connected to MongoDB.")
except Exception as e:
    print(f"❌ Database connection failed: {e}")

# --- 3. BOT SETUP ---
intents = discord.Intents.default()
intents.message_content = True
intents.members = True 
bot = commands.Bot(command_prefix="/", intents=intents)

# --- 4. HELPER FUNCTIONS ---

def get_utc_now():
    """Returns current time in UTC (Timezone Aware)."""
    return datetime.datetime.now(datetime.timezone.utc)

def is_manager(user):
    has_role = any(r.id == MANAGER_ROLE_ID for r in user.roles)
    return has_role or user.id == OWNER_ID

def is_staff(user):
    user_roles = [r.id for r in user.roles]
    return (COOK_ROLE_ID in user_roles) or \
           (DELIVERY_ROLE_ID in user_roles) or \
           (MANAGER_ROLE_ID in user_roles) or \
           (user.id == OWNER_ID)

def has_bypass(member):
    if QUOTA_BYPASS_ROLE_ID == 0: return False
    return any(r.id == QUOTA_BYPASS_ROLE_ID for r in member.roles)

def is_senior_cook(member):
    return any(r.id == SENIOR_COOK_ROLE_ID for r in member.roles)

def is_senior_delivery(member):
    return any(r.id == SENIOR_DELIVERY_ROLE_ID for r in member.roles)

def get_images_str(order_data):
    images = order_data.get('images', [])
    if not images and order_data.get('image_link'):
        images = [order_data['image_link']]
    if not images: return "No Image Attached"
    return "\n".join(images)

async def update_master_log(order_id):
    channel = bot.get_channel(BACKUP_CHANNEL_ID)
    if not channel: return
    o = orders_col.find_one({"order_id": order_id})
    if not o: return

    status_map = {
        "pending": ("⬜ PENDING", discord.Color.light_grey()),
        "claimed": ("✋ CLAIMED", BRAND_COLOR),
        "cooking": ("👨‍🍳 COOKING", discord.Color.orange()),
        "ready": ("📦 READY", discord.Color.green()),
        "delivered": ("🚴 DELIVERED", discord.Color.blue()),
        "cancelled_warn": ("⚠️ CANCELLED (WARN)", discord.Color.red()),
        "cancelled_fdo": ("🛑 CANCELLED (FORCE)", discord.Color.dark_red())
    }
    status_text, color = status_map.get(o['status'], ("UNKNOWN", discord.Color.default()))
    
    embed = discord.Embed(title=f"🍩 {BRAND_NAME} Order #{order_id}", color=color)
    embed.add_field(name="Status", value=f"**{status_text}**", inline=True)
    embed.add_field(name="Item", value=o['item'], inline=True)
    embed.add_field(name="Client", value=f"<@{o['user_id']}>", inline=True)
    
    chef = o.get('chef_name', 'None')
    deliverer = o.get('deliverer_id', 'None')
    if deliverer != 'None' and deliverer.isdigit(): deliverer = f"<@{deliverer}>"
    
    embed.add_field(name="Chef", value=chef, inline=True)
    embed.add_field(name="Deliverer", value=deliverer, inline=True)
    
    # Use timestamp() for Discord format
    created_ts = int(o['created_at'].timestamp())
    embed.add_field(name="Created", value=f"<t:{created_ts}:R>", inline=True)

    if 'backup_msg_id' not in o:
        try:
            msg = await channel.send(embed=embed)
            orders_col.update_one({"order_id": order_id}, {"$set": {"backup_msg_id": msg.id}})
        except: pass
    else:
        try:
            msg = await channel.fetch_message(o['backup_msg_id'])
            await msg.edit(embed=embed)
        except:
            try:
                msg = await channel.send(embed=embed)
                orders_col.update_one({"order_id": order_id}, {"$set": {"backup_msg_id": msg.id}})
            except: pass

def calculate_quota_target(staff_count):
    if staff_count <= 0: return 5
    target = math.ceil(5 / staff_count)
    return max(1, target)

def calculate_dynamic_targets(total_volume, staff_count):
    if staff_count == 0: return 0, 0
    raw_target = math.ceil(total_volume / staff_count)
    normal_target = min(raw_target, 30)
    senior_target = math.ceil(normal_target / 2)
    if total_volume > 0:
        normal_target = max(1, normal_target)
        senior_target = max(1, senior_target)
    return normal_target, senior_target

def generate_key_string():
    """Generates a random key like VIP-A1B2-C3D4"""
    def seg(): return ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"VIP-{seg()}-{seg()}-{seg()}"

# --- 5. UI CLASSES (Vacation) ---

class VacationEditModal(discord.ui.Modal, title="Edit Vacation Duration"):
    days = discord.ui.TextInput(label="New Duration (Days)", placeholder="Enter number 1-14", min_length=1, max_length=2)

    def __init__(self, target_user, original_message):
        super().__init__()
        self.target_user = target_user
        self.original_message = original_message

    async def on_submit(self, interaction: discord.Interaction):
        try:
            new_days = int(self.days.value)
            if not 1 <= new_days <= 14:
                return await interaction.response.send_message("❌ Must be between 1 and 14 days.", ephemeral=True)
            
            end_date = get_utc_now() + datetime.timedelta(days=new_days)
            vacations_col.update_one(
                {"user_id": str(self.target_user.id)},
                {"$set": {"status": "active", "end_date": end_date}},
                upsert=True
            )
            role = interaction.guild.get_role(QUOTA_BYPASS_ROLE_ID)
            if role: await self.target_user.add_roles(role)
            timestamp = int(end_date.timestamp())
            
            embed = self.original_message.embeds[0]
            embed.color = discord.Color.green()
            embed.set_field_at(1, name="Duration", value=f"{new_days} Days (Edited)", inline=True)
            embed.set_footer(text=f"Approved (Edited) by {interaction.user.display_name}")
            
            await self.original_message.edit(embed=embed, view=None)
            await interaction.response.send_message(f"✅ Modified & Approved for **{new_days} days**.", ephemeral=True)
            try: await self.target_user.send(f"🌴 **Vacation Approved (Modified)!**\nDuration: {new_days} days\nEnds: <t:{timestamp}:R>")
            except: pass
        except ValueError:
            await interaction.response.send_message("❌ Invalid number.", ephemeral=True)

class VacationDenyModal(discord.ui.Modal, title="Deny Vacation Request"):
    reason = discord.ui.TextInput(label="Reason for Denial", style=discord.TextStyle.paragraph, placeholder="Why is this request being denied?", required=True)

    def __init__(self, target_user, original_message):
        super().__init__()
        self.target_user = target_user
        self.original_message = original_message

    async def on_submit(self, interaction: discord.Interaction):
        embed = self.original_message.embeds[0]
        embed.color = discord.Color.red()
        embed.add_field(name="Denial Reason", value=self.reason.value, inline=False)
        embed.set_footer(text=f"Denied by {interaction.user.display_name}")
        await self.original_message.edit(embed=embed, view=None)
        await interaction.response.send_message("❌ Request Denied.", ephemeral=True)
        try: await self.target_user.send(f"❌ **Vacation Request Denied**\n**Reason:** {self.reason.value}")
        except: pass

class VacationView(discord.ui.View):
    def __init__(self, target_user, days):
        super().__init__(timeout=None)
        self.target_user = target_user
        self.days = days

    @discord.ui.button(label="Approve", style=discord.ButtonStyle.green, custom_id="vac_approve")
    async def approve(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not is_manager(interaction.user): return await interaction.response.send_message("❌ Managers only.", ephemeral=True)
        end_date = get_utc_now() + datetime.timedelta(days=self.days)
        vacations_col.update_one(
            {"user_id": str(self.target_user.id)},
            {"$set": {"status": "active", "end_date": end_date}},
            upsert=True
        )
        role = interaction.guild.get_role(QUOTA_BYPASS_ROLE_ID)
        if role: await self.target_user.add_roles(role)
        timestamp = int(end_date.timestamp())
        
        embed = interaction.message.embeds[0]
        embed.color = discord.Color.green()
        embed.set_footer(text=f"Approved by {interaction.user.display_name}")
        
        self.clear_items()
        await interaction.message.edit(embed=embed, view=self)
        await interaction.response.send_message(f"✅ Approved for {self.days} days.", ephemeral=True)
        try: await self.target_user.send(f"🌴 **Vacation Approved!**\nEnds: <t:{timestamp}:R>")
        except: pass

    @discord.ui.button(label="Edit Duration", style=discord.ButtonStyle.blurple, custom_id="vac_edit")
    async def edit(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not is_manager(interaction.user): return await interaction.response.send_message("❌ Managers only.", ephemeral=True)
        await interaction.response.send_modal(VacationEditModal(self.target_user, interaction.message))

    @discord.ui.button(label="Deny", style=discord.ButtonStyle.red, custom_id="vac_deny")
    async def deny(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not is_manager(interaction.user): return await interaction.response.send_message("❌ Managers only.", ephemeral=True)
        await interaction.response.send_modal(VacationDenyModal(self.target_user, interaction.message))

# --- 6. EVENTS & TASKS ---

@bot.event
async def on_ready():
    print(f'🍩 {BRAND_NAME} is online as {bot.user}')
    if not auto_delivery_task.is_running(): auto_delivery_task.start()
    if not auto_unclaim_task.is_running(): auto_unclaim_task.start()
    if not check_premium_expiry.is_running(): check_premium_expiry.start()
    if not weekly_quota_check.is_running(): weekly_quota_check.start()
    if not check_vacations.is_running(): check_vacations.start()
    try:
        synced = await bot.tree.sync()
        print(f"✨ Synced {len(synced)} commands")
    except Exception as e: print(e)

@tasks.loop(minutes=60)
async def check_premium_expiry():
    now = get_utc_now()
    expired = premium_col.find({"is_vip": True, "expires_at": {"$lt": now}})
    for u in expired:
        premium_col.update_one({"user_id": u['user_id']}, {"$set": {"is_vip": False}, "$unset": {"expires_at": ""}})
        try:
            support_guild = bot.get_guild(SUPPORT_SERVER_ID)
            if support_guild:
                member = support_guild.get_member(int(u['user_id']))
                role = support_guild.get_role(VIP_ROLE_ID)
                if member and role: await member.remove_roles(role)
        except: pass

@tasks.loop(minutes=60)
async def check_vacations():
    now = get_utc_now()
    expired = vacations_col.find({"status": "active", "end_date": {"$lt": now}})
    for v in expired:
        uid = int(v['user_id'])
        vacations_col.update_one({"user_id": v['user_id']}, {"$set": {"status": "expired"}})
        for guild in bot.guilds:
            member = guild.get_member(uid)
            if member:
                role = guild.get_role(QUOTA_BYPASS_ROLE_ID)
                if role: 
                    await member.remove_roles(role)
                    try: await member.send("👋 **Welcome Back!** Your vacation has ended.")
                    except: pass

@tasks.loop(minutes=1)
async def auto_unclaim_task():
    threshold = get_utc_now() - datetime.timedelta(minutes=4)
    expired = orders_col.find({"status": "claimed", "claimed_at": {"$lt": threshold}})
    cook_channel = bot.get_channel(COOK_CHANNEL_ID)
    for o in expired:
        orders_col.update_one({"order_id": o['order_id']}, 
                              {"$set": {"status": "pending", "chef_name": None}, "$unset": {"claimed_at": ""}})
        await update_master_log(o['order_id'])
        if cook_channel: await cook_channel.send(f"📢 **Claim Expired!** `{o['order_id']}` is **Pending** again.")

@tasks.loop(minutes=1)
async def auto_delivery_task():
    threshold = get_utc_now() - datetime.timedelta(minutes=20)
    overdue = orders_col.find({"status": "ready", "ready_at": {"$lt": threshold}})
    for o in overdue:
        img_str = get_images_str(o)
        msg = (f"<@{o['user_id']}> 🤖 **Auto-Delivery**\nChef: {o['chef_name']}\n{img_str}")
        try:
            guild = bot.get_guild(int(o['guild_id']))
            target = None
            if guild:
                target = guild.get_channel(int(o['channel_id']))
                if not target:
                    for c in guild.text_channels:
                        if c.permissions_for(guild.me).send_messages: target = c; break
                if target:
                    await target.send(msg)
                    orders_col.update_one({"order_id": o['order_id']}, 
                                          {"$set": {"status": "delivered", "deliverer_id": "AUTO_BOT"}})
                    await update_master_log(o['order_id'])
                    dc = bot.get_channel(DELIVERY_CHANNEL_ID)
                    if dc: await dc.send(f"🤖 **Auto-Delivered** `{o['order_id']}`.")
        except Exception: pass

async def run_quota_logic(guild):
    quota_channel = bot.get_channel(QUOTA_CHANNEL_ID)
    if not quota_channel: return

    cook_role = guild.get_role(COOK_ROLE_ID)
    deliver_role = guild.get_role(DELIVERY_ROLE_ID)
    
    cooks = cook_role.members if cook_role else []
    deliverers = deliver_role.members if deliver_role else []

    total_cook_volume = sum([users_col.find_one({"user_id": str(m.id)}).get("cook_count_week", 0) 
                             if users_col.find_one({"user_id": str(m.id)}) else 0 for m in cooks])
    total_deliver_volume = sum([users_col.find_one({"user_id": str(m.id)}).get("deliver_count_week", 0) 
                                if users_col.find_one({"user_id": str(m.id)}) else 0 for m in deliverers])

    c_norm, c_senior = calculate_dynamic_targets(total_cook_volume, len(cooks))
    d_norm, d_senior = calculate_dynamic_targets(total_deliver_volume, len(deliverers))
    
    report_msg = (f"📊 **Weekly Quota Report**\n"
                  f"🍩 Total Cooked: {total_cook_volume} | 🚴 Total Delivered: {total_deliver_volume}\n"
                  f"**Targets:** Normal `{c_norm}` | Senior `{c_senior}` (Max 30)\n\n")

    # Cooks
    report_msg += "__**👨‍🍳 Kitchen Staff**__\n"
    for member in cooks:
        if has_bypass(member):
             users_col.update_one({"user_id": str(member.id)}, {"$set": {"cook_count_week": 0}})
             report_msg += f"🛡️ {member.mention}: Exempt (Bypass/Vacation)\n"
             continue

        target = c_senior if is_senior_cook(member) else c_norm
        user_data = users_col.find_one({"user_id": str(member.id)}) or {}
        done = user_data.get("cook_count_week", 0)
        fails = user_data.get("quota_fails_cook", 0)

        if total_cook_volume < 5 and len(cooks) > 1:
            report_msg += f"⚪ {member.mention}: {done} (Exempt - Low Traffic)\n"
            users_col.update_one({"user_id": str(member.id)}, {"$set": {"cook_count_week": 0}})
            continue

        if done >= target:
            users_col.update_one({"user_id": str(member.id)}, 
                                 {"$set": {"cook_count_week": 0, "quota_fails_cook": 0}})
            report_msg += f"✅ {member.mention}: {done}/{target} (Passed)\n"
            try: await member.send(f"🎉 **Quota Met!** You cooked {done}/{target} orders.")
            except: pass
        else:
            fails += 1
            if fails >= 2:
                await member.remove_roles(cook_role)
                users_col.update_one({"user_id": str(member.id)}, 
                                     {"$set": {"cook_count_week": 0, "quota_fails_cook": 0}})
                report_msg += f"❌ {member.mention}: {done}/{target} (**ROLE REMOVED** - 2nd Miss)\n"
                try: await member.send(f"🛑 **Role Removed.** You missed quota 2 weeks in a row.")
                except: pass
            else:
                users_col.update_one({"user_id": str(member.id)}, 
                                     {"$set": {"cook_count_week": 0, "quota_fails_cook": fails}})
                report_msg += f"⚠️ {member.mention}: {done}/{target} (Strike {fails}/2)\n"
                try: await member.send(f"⚠️ **Quota Missed.** You did {done}/{target}. Strike 1/2.")
                except: pass

    # Delivery
    report_msg += "\n__**🚴 Delivery Staff**__\n"
    for member in deliverers:
        if has_bypass(member):
             users_col.update_one({"user_id": str(member.id)}, {"$set": {"deliver_count_week": 0}})
             report_msg += f"🛡️ {member.mention}: Exempt (Bypass/Vacation)\n"
             continue

        target = d_senior if is_senior_delivery(member) else d_norm
        user_data = users_col.find_one({"user_id": str(member.id)}) or {}
        done = user_data.get("deliver_count_week", 0)
        fails = user_data.get("quota_fails_deliver", 0)

        if total_deliver_volume < 5 and len(deliverers) > 1:
             report_msg += f"⚪ {member.mention}: {done} (Exempt - Low Traffic)\n"
             users_col.update_one({"user_id": str(member.id)}, {"$set": {"deliver_count_week": 0}})
             continue

        if done >= target:
            users_col.update_one({"user_id": str(member.id)}, 
                                 {"$set": {"deliver_count_week": 0, "quota_fails_deliver": 0}})
            report_msg += f"✅ {member.mention}: {done}/{target} (Passed)\n"
            try: await member.send(f"🎉 **Quota Met!** You delivered {done}/{target} orders.")
            except: pass
        else:
            fails += 1
            if fails >= 2:
                await member.remove_roles(deliver_role)
                users_col.update_one({"user_id": str(member.id)}, 
                                     {"$set": {"deliver_count_week": 0, "quota_fails_deliver": 0}})
                report_msg += f"❌ {member.mention}: {done}/{target} (**ROLE REMOVED** - 2nd Miss)\n"
            else:
                users_col.update_one({"user_id": str(member.id)}, 
                                     {"$set": {"deliver_count_week": 0, "quota_fails_deliver": fails}})
                report_msg += f"⚠️ {member.mention}: {done}/{target} (Strike {fails}/2)\n"

    await quota_channel.send(report_msg[:2000])

@tasks.loop(hours=1)
async def weekly_quota_check():
    now = get_utc_now()
    if now.weekday() == 6 and now.hour == 23:
        last_run = config_col.find_one({"key": "last_quota_run"})
        # Ensure we use timezone aware comparison
        if last_run and (now - last_run['date'].replace(tzinfo=datetime.timezone.utc)).total_seconds() < 43200:
            return
        for guild in bot.guilds:
            await run_quota_logic(guild)
        config_col.update_one({"key": "last_quota_run"}, {"$set": {"date": now}}, upsert=True)

# --- 7. NEW COMMANDS (GENERATE CODES & REDEEM) ---

@bot.tree.command(name="generate_codes", description="Generate premium codes (Owner Only)")
async def generate_codes(interaction: discord.Interaction, amount: int):
    # OWNER ONLY CHECK
    if interaction.user.id != OWNER_ID:
        return await interaction.response.send_message("❌ Owner only.", ephemeral=True)
    
    if amount < 1 or amount > 50:
        return await interaction.response.send_message("❌ Please generate between 1 and 50 codes at a time.", ephemeral=True)

    generated_codes = []
    for _ in range(amount):
        new_code = generate_key_string()
        codes_col.insert_one({
            "code": new_code,
            "status": "unused",
            "duration_days": 30,
            "created_at": get_utc_now(),
            "created_by": str(interaction.user.id)
        })
        generated_codes.append(new_code)

    code_text = "\n".join(generated_codes)
    file = discord.File(io.StringIO(code_text), filename="premium_codes.txt")
    
    await interaction.response.send_message(f"✅ Generated {amount} codes.", file=file, ephemeral=True)

@bot.tree.command(name="redeem", description="Redeem a Premium Code (30 Days)")
async def redeem(interaction: discord.Interaction, code: str):
    await interaction.response.defer(ephemeral=True)
    
    # Atomic Check-and-Set to ensure 1-time use
    code_data = codes_col.find_one_and_update(
        {"code": code, "status": "unused"},
        {"$set": {
            "status": "redeemed",
            "redeemed_by": str(interaction.user.id),
            "redeemed_at": get_utc_now()
        }},
        return_document=ReturnDocument.AFTER
    )
    
    if not code_data:
        return await interaction.followup.send("❌ Invalid or used code.", ephemeral=True)
    
    expiry = get_utc_now() + datetime.timedelta(days=30)
    premium_col.update_one(
        {"user_id": str(interaction.user.id)}, 
        {"$set": {"is_vip": True, "expires_at": expiry, "redeemed_code": code}}, 
        upsert=True
    )
    
    try:
        support_guild = bot.get_guild(SUPPORT_SERVER_ID)
        if support_guild:
            member = support_guild.get_member(interaction.user.id)
            role = support_guild.get_role(VIP_ROLE_ID)
            if member and role:
                await member.add_roles(role)
    except: pass

    await interaction.followup.send(f"💎 **Premium Activated!** Valid for 30 days.", ephemeral=True)

# --- 8. OTHER COMMANDS ---

@bot.tree.command(name="help", description="Show available commands")
async def help(interaction: discord.Interaction):
    user_roles = [r.id for r in interaction.user.roles]
    is_cook = COOK_ROLE_ID in user_roles
    is_delivery = DELIVERY_ROLE_ID in user_roles
    user_is_manager = is_manager(interaction.user)
    is_owner = interaction.user.id == OWNER_ID

    embed = discord.Embed(title=f"🍩 {BRAND_NAME} Help Menu", color=BRAND_COLOR)
    
    customer_cmds = (
        "`/order <item>` - Place a new order\n"
        "`/rate <id> <1-5>` - Rate a delivered order\n"
        "`/complain <id> <reason>` - Report an issue\n"
        "`/redeem <code>` - Activate Premium\n"
        "`/rules` - View server rules"
    )
    embed.add_field(name="🧑‍🍳 Customer Menu", value=customer_cmds, inline=False)

    if is_cook or user_is_manager:
        cook_cmds = (
            "`/orderlist` - View active queue\n"
            "`/claim <id>` - Claim an order\n"
            "`/cook <id> <images...>` - Finish order\n"
            "`/unclaim <id>` - Drop an order\n"
            "`/warn <id> <reason>` - Warn user\n"
            "`/orderinfo <id>` - View details\n"
            "`/quota` - Check weekly progress\n"
            "`/stats [user]` - View lifetime stats\n"
            "`/vacation <days> <reason>` - Request time off"
        )
        embed.add_field(name="🥣 Kitchen Staff", value=cook_cmds, inline=False)

    if is_delivery or user_is_manager:
        del_cmds = (
            "`/deliver <id>` - Deliver ready order\n"
            "`/setscript <text>` - Custom delivery message\n"
            "`/quota` - Check weekly progress\n"
            "`/stats [user]` - View lifetime stats\n"
            "`/vacation <days> <reason>` - Request time off"
        )
        embed.add_field(name="🚴 Delivery Team", value=del_cmds, inline=False)

    if user_is_manager:
        mgr_cmds = (
            "`/fdo <id> <reason>` - Force Delete & Warn\n"
            "`/unban <user>` - Remove ban\n"
            "`/runquota` - Force run weekly quota"
        )
        embed.add_field(name="🛡️ Management", value=mgr_cmds, inline=False)

    if is_owner:
        owner_cmds = (
            "`/addvip <user>` - Gift VIP status\n"
            "`/removevip <user>` - Revoke VIP status\n"
            "`/generate_codes <amount>` - Create premium keys"
        )
        embed.add_field(name="👑 Owner", value=owner_cmds, inline=False)

    await interaction.response.send_message(embed=embed, ephemeral=True)

@bot.tree.command(name="quota", description="Check your weekly quota progress")
async def quota(interaction: discord.Interaction):
    if not is_staff(interaction.user):
        return await interaction.response.send_message("❌ Only staff can check quotas.", ephemeral=True)

    uid = str(interaction.user.id)
    user_data = users_col.find_one({"user_id": uid}) or {}
    
    cook_done = user_data.get("cook_count_week", 0)
    deliver_done = user_data.get("deliver_count_week", 0)
    
    cook_role = interaction.guild.get_role(COOK_ROLE_ID)
    del_role = interaction.guild.get_role(DELIVERY_ROLE_ID)
    
    cooks = cook_role.members if cook_role else []
    deliverers = del_role.members if del_role else []
    
    total_cook_volume = sum([users_col.find_one({"user_id": str(m.id)}).get("cook_count_week", 0) 
                             if users_col.find_one({"user_id": str(m.id)}) else 0 for m in cooks])
    total_deliver_volume = sum([users_col.find_one({"user_id": str(m.id)}).get("deliver_count_week", 0) 
                                if users_col.find_one({"user_id": str(m.id)}) else 0 for m in deliverers])

    c_norm, c_senior = calculate_dynamic_targets(total_cook_volume, len(cooks))
    d_norm, d_senior = calculate_dynamic_targets(total_deliver_volume, len(deliverers))

    msg = "📊 **Your Weekly Quota Status:**\n"
    if has_bypass(interaction.user):
        msg += "\n🛡️ **You are exempt from quota requirements (Bypass/Vacation).**"
    
    if COOK_ROLE_ID in [r.id for r in interaction.user.roles]:
        target = c_senior if is_senior_cook(interaction.user) else c_norm
        status = "✅" if cook_done >= target else "⚠️"
        msg += f"👨‍🍳 **Cooking:** {cook_done} / {target} {status}\n"

    if DELIVERY_ROLE_ID in [r.id for r in interaction.user.roles]:
        target = d_senior if is_senior_delivery(interaction.user) else d_norm
        status = "✅" if deliver_done >= target else "⚠️"
        msg += f"🚴 **Delivery:** {deliver_done} / {target} {status}\n"

    await interaction.response.send_message(msg, ephemeral=True)

@bot.tree.command(name="stats", description="View staff performance statistics")
async def stats(interaction: discord.Interaction, user: discord.User = None):
    if not is_staff(interaction.user):
        return await interaction.response.send_message("❌ Only staff can view stats.", ephemeral=True)

    target_user = user or interaction.user
    uid = str(target_user.id)
    
    user_data = users_col.find_one({"user_id": uid})
    if not user_data:
        return await interaction.response.send_message(f"❌ No data found for {target_user.mention}.", ephemeral=True)

    cook_week = user_data.get("cook_count_week", 0)
    cook_total = user_data.get("cook_count_total", 0)
    del_week = user_data.get("deliver_count_week", 0)
    del_total = user_data.get("deliver_count_total", 0)

    rated_orders = list(orders_col.find({"deliverer_id": uid, "rating": {"$exists": True}}))
    avg_rating = "N/A"
    if rated_orders:
        total_stars = sum([o['rating'] for o in rated_orders])
        avg_rating = f"{round(total_stars / len(rated_orders), 1)} ⭐"

    embed = discord.Embed(title=f"📈 Staff Stats: {target_user.display_name}", color=discord.Color.purple())
    embed.set_thumbnail(url=target_user.avatar.url if target_user.avatar else None)
    embed.add_field(name="👨‍🍳 Cooking", value=f"**Weekly:** {cook_week}\n**Lifetime:** {cook_total}", inline=True)
    embed.add_field(name="🚴 Delivery", value=f"**Weekly:** {del_week}\n**Lifetime:** {del_total}", inline=True)
    embed.add_field(name="⭐ Avg Rating", value=avg_rating, inline=False)
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="vacation", description="Request time off (Max 14 Days)")
async def vacation(interaction: discord.Interaction, days: int, reason: str):
    if not is_staff(interaction.user):
        return await interaction.response.send_message("❌ Only staff can request vacation.", ephemeral=True)
    
    if not 1 <= days <= 14:
        return await interaction.response.send_message("❌ Vacation duration must be between 1 and 14 days.", ephemeral=True)

    if vacations_col.find_one({"user_id": str(interaction.user.id), "status": "active"}):
        return await interaction.response.send_message("❌ You already have an active vacation.", ephemeral=True)

    qc = bot.get_channel(VACATION_CHANNEL_ID)
    if not qc: return await interaction.response.send_message("❌ Configuration Error: Vacation channel not found.", ephemeral=True)

    embed = discord.Embed(title="🌴 Vacation Request", color=discord.Color.teal())
    embed.add_field(name="Staff", value=interaction.user.mention, inline=True)
    embed.add_field(name="Duration", value=f"{days} Days", inline=True)
    embed.add_field(name="Reason", value=reason, inline=False)
    embed.set_footer(text="Management: Approve, Deny or Edit Duration")

    view = VacationView(target_user=interaction.user, days=days)
    await qc.send(embed=embed, view=view)
    await interaction.response.send_message("✅ Request sent to management.", ephemeral=True)

@bot.tree.command(name="runquota", description="Management: Force run the weekly quota check")
@commands.has_role(MANAGER_ROLE_ID)
async def runquota(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    await run_quota_logic(interaction.guild)
    await interaction.followup.send("✅ Quota check executed. Check the quota log channel.")

@bot.tree.command(name="order", description="Place an order")
async def order(interaction: discord.Interaction, item: str):
    uid = str(interaction.user.id)
    user_data = users_col.find_one({"user_id": uid})
    if user_data:
        if user_data.get("is_banned") == 1:
            msg = (f"🛑 **Permanent Ban.**\nAppeal: {SUPPORT_SERVER_LINK}\nEmail: {SUPPORT_EMAIL}")
            return await interaction.response.send_message(msg, ephemeral=True)
        ban_expiry = user_data.get("ban_expires_at")
        if ban_expiry:
            if ban_expiry > get_utc_now():
                timestamp = int(ban_expiry.timestamp())
                return await interaction.response.send_message(f"🛑 **Temporary Ban.**\nOrder again <t:{timestamp}:R>.\nAppeal: {SUPPORT_SERVER_LINK}", ephemeral=True)
            else: users_col.update_one({"user_id": uid}, {"$unset": {"ban_expires_at": ""}})

    if orders_col.find_one({"user_id": uid, "status": {"$in": ["pending", "claimed", "cooking", "ready"]}}):
        return await interaction.response.send_message("❌ You have an active order.", ephemeral=True)

    is_vip = bool(premium_col.find_one({"user_id": uid, "is_vip": True}))
    oid = str(uuid.uuid4())[:6].upper()
    
    orders_col.insert_one({
        "order_id": oid, "user_id": uid, "guild_id": str(interaction.guild.id),
        "channel_id": str(interaction.channel.id), "status": "pending", "item": item,
        "is_vip": is_vip, "created_at": get_utc_now(), 
        "chef_name": None, "images": [] 
    })
    await update_master_log(oid)
    cc = bot.get_channel(COOK_CHANNEL_ID)
    if cc:
        server_name = interaction.guild.name
        channel_name = interaction.channel.name
        prefix = "💎 **VIP ORDER!**" if is_vip else "🍩 **New Order!**"
        await cc.send(f"{prefix} `{oid}`\nClient: {interaction.user.mention}\nRequest: **{item}**\n📍 Server: **{server_name}**\n#️⃣ Channel: **#{channel_name}**\n@here" if is_vip else "@here" if False else "")
    await interaction.response.send_message(f"✅ Order `{oid}` placed!", ephemeral=True)

@bot.tree.command(name="rate", description="Rate us 1-5 stars")
async def rate(interaction: discord.Interaction, order_id: str, stars: int):
    if not 1 <= stars <= 5: return await interaction.response.send_message("1-5 only.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id, "user_id": str(interaction.user.id)})
    if not o or o['status'] != 'delivered': return await interaction.response.send_message("Order must be delivered first.", ephemeral=True)
    orders_col.update_one({"order_id": order_id}, {"$set": {"rating": stars}})
    await update_master_log(order_id)
    rc = bot.get_channel(RATINGS_CHANNEL_ID)
    if rc: await rc.send(f"{'⭐'*stars} **Rating!** `{order_id}`\nChef: {o.get('chef_name')}")
    await interaction.response.send_message("Thank you!", ephemeral=True)

@bot.tree.command(name="complain", description="File complaint")
async def complain(interaction: discord.Interaction, order_id: str, reason: str):
    o = orders_col.find_one({"order_id": order_id, "user_id": str(interaction.user.id)})
    if not o: return await interaction.response.send_message("Invalid ID.", ephemeral=True)
    orders_col.update_one({"order_id": order_id}, {"$set": {"complaint": reason}})
    lc = bot.get_channel(COMPLAINT_CHANNEL_ID)
    if lc: await lc.send(f"🚨 **Complaint** `{order_id}`\nUser: <@{o['user_id']}>\nMsg: {reason}")
    await interaction.response.send_message("Sent to management.", ephemeral=True)

@bot.tree.command(name="orderlist", description="View Queue")
async def orderlist(interaction: discord.Interaction):
    if interaction.channel.id != COOK_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{COOK_CHANNEL_ID}>.", ephemeral=True)
    active = orders_col.find({"status": {"$in": ["pending", "claimed", "cooking", "ready"]}}).sort([("is_vip", -1), ("created_at", 1)])
    msg = "**🍩 Queue:**\n"
    count = 0
    for o in active:
        count+=1
        vip = "💎" if o.get('is_vip') else ""
        emoji = {"claimed": "✋", "cooking": "👨‍🍳", "ready": "📦"}.get(o['status'], "⬜")
        msg += f"{vip}`{o['order_id']}`: {emoji} **{o['status'].upper()}** ({o['item']})\n"
    if count == 0: msg = "Queue empty."
    await interaction.response.send_message(msg, ephemeral=True)

@bot.tree.command(name="claim", description="Claim order (4m timer)")
@commands.has_role(COOK_ROLE_ID)
async def claim(interaction: discord.Interaction, order_id: str):
    if interaction.channel.id != COOK_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{COOK_CHANNEL_ID}>.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id})
    if not o or o['status'] != 'pending': return await interaction.response.send_message("Cannot claim.", ephemeral=True)
    orders_col.update_one({"order_id": order_id}, 
                          {"$set": {"status": "claimed", "chef_name": interaction.user.display_name, "claimed_at": get_utc_now()}})
    try:
        u = await bot.fetch_user(int(o['user_id']))
        await u.send(f"👨‍🍳 **Update:** Your order `{order_id}` has been claimed by **{interaction.user.display_name}**! Cooking will begin shortly.")
    except: pass
    await update_master_log(order_id)
    await interaction.response.send_message(f"⏱️ Claimed `{order_id}`. Cook within 4 mins.")

@bot.tree.command(name="unclaim", description="Release claim")
@commands.has_role(COOK_ROLE_ID)
async def unclaim(interaction: discord.Interaction, order_id: str):
    if interaction.channel.id != COOK_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{COOK_CHANNEL_ID}>.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id})
    if not o or o['status'] != 'claimed': return await interaction.response.send_message("Not claimed.", ephemeral=True)
    if o['chef_name'] != interaction.user.display_name and not is_manager(interaction.user): return await interaction.response.send_message("Not your claim.", ephemeral=True)
    orders_col.update_one({"order_id": order_id}, {"$set": {"status": "pending", "chef_name": None}, "$unset": {"claimed_at": ""}})
    await update_master_log(order_id)
    await interaction.response.send_message(f"🔓 `{order_id}` released.")

@bot.tree.command(name="cook", description="Cook order (Supports up to 3 attachments)")
@commands.has_role(COOK_ROLE_ID)
async def cook(interaction: discord.Interaction, order_id: str, main_image: discord.Attachment, extra_image_1: discord.Attachment = None, extra_image_2: discord.Attachment = None):
    if interaction.channel.id != COOK_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{COOK_CHANNEL_ID}>.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id})
    if not o: return await interaction.response.send_message("Not found.", ephemeral=True)
    if o['status'] == 'pending': return await interaction.response.send_message("Must `/claim` first.", ephemeral=True)
    if o['status'] == 'claimed' and o['chef_name'] != interaction.user.display_name: return await interaction.response.send_message("Not your claim.", ephemeral=True)
    
    image_list = [main_image.url]
    if extra_image_1: image_list.append(extra_image_1.url)
    if extra_image_2: image_list.append(extra_image_2.url)
    
    orders_col.update_one({"order_id": order_id}, {"$set": {"status": "cooking", "images": image_list}})
    users_col.update_one({"user_id": str(interaction.user.id)}, 
                         {"$inc": {"cook_count_week": 1, "cook_count_total": 1}}, upsert=True)
    
    finish_time = int((get_utc_now() + datetime.timedelta(minutes=3)).timestamp())
    try:
        u = await bot.fetch_user(int(o['user_id']))
        await u.send(f"🍳 **Cooking Started!** Your order `{order_id}` is on the stove. Ready <t:{finish_time}:R>.")
    except: pass

    await update_master_log(order_id)
    await interaction.response.send_message(f"👨‍🍳 Cooking `{order_id}`... (3m)")
    await asyncio.sleep(180)
    orders_col.update_one({"order_id": order_id}, {"$set": {"status": "ready", "ready_at": get_utc_now()}})
    
    try:
        u = await bot.fetch_user(int(o['user_id']))
        await u.send(f"📦 **Order Ready!** Your treat `{order_id}` is fresh out of the oven. Waiting for a delivery driver!")
    except: pass

    await update_master_log(order_id)
    dc = bot.get_channel(DELIVERY_CHANNEL_ID)
    if dc: await dc.send(f"📦 **Ready!** `{order_id}`\nChef: {interaction.user.display_name}\nUse `/deliver {order_id}`")

@bot.tree.command(name="orderinfo", description="Staff view order details")
@commands.has_role(COOK_ROLE_ID)
async def orderinfo(interaction: discord.Interaction, order_id: str):
    if interaction.channel.id != COOK_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{COOK_CHANNEL_ID}>.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id})
    if not o: return await interaction.response.send_message("Not found.", ephemeral=True)
    embed = discord.Embed(title=f"📋 {order_id}", color=discord.Color.blue())
    embed.add_field(name="User", value=f"<@{o['user_id']}>")
    embed.add_field(name="Item", value=o['item'])
    embed.add_field(name="Status", value=o['status'])
    if o.get('is_vip'): embed.set_footer(text="💎 VIP CLIENT")
    await interaction.response.send_message(embed=embed, ephemeral=True)

@bot.tree.command(name="warn", description="Pre-Cook Warn")
@commands.has_role(COOK_ROLE_ID)
async def warn(interaction: discord.Interaction, order_id: str, reason: str):
    if interaction.channel.id != COOK_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{COOK_CHANNEL_ID}>.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id})
    if not o or o['status'] in ['ready', 'delivered']: return await interaction.response.send_message("Too late/Invalid.", ephemeral=True)
    await apply_warning_logic(interaction, o, reason, "warn")

@bot.tree.command(name="deliver", description="Deliver order")
@commands.has_role(DELIVERY_ROLE_ID)
async def deliver(interaction: discord.Interaction, order_id: str):
    if interaction.channel.id != DELIVERY_CHANNEL_ID and not is_manager(interaction.user):
        return await interaction.response.send_message(f"❌ Go to <#{DELIVERY_CHANNEL_ID}>.", ephemeral=True)
    o = orders_col.find_one({"order_id": order_id})
    if not o or o['status'] != 'ready': return await interaction.response.send_message("Not ready.", ephemeral=True)
    
    s = scripts_col.find_one({"user_id": str(interaction.user.id)})
    txt = s['script'] if s else "Here is your order! 🍩"
    img_str = get_images_str(o)
    msg = f"<@{o['user_id']}> {txt}\nChef: {o['chef_name']}\n{img_str}"
    
    guild = bot.get_guild(int(o['guild_id']))
    if not guild: return await interaction.response.send_message("❌ I am not in that server.", ephemeral=True)
    invite = None
    try:
        c = guild.get_channel(int(o['channel_id']))
        if c: invite = await c.create_invite(max_age=300, max_uses=1)
    except: pass
    if not invite:
        for c in guild.text_channels:
            if c.permissions_for(guild.me).create_instant_invite:
                try: invite = await c.create_invite(max_age=300, max_uses=1); break
                except: continue

    if invite:
        instr = f"🚴 **Delivery** `{order_id}`\n**Link:** {invite}\n**Post This:**\n```\n{msg}\n```"
        try:
            await interaction.user.send(instr)
            orders_col.update_one({"order_id": order_id}, {"$set": {"status": "delivered", "deliverer_id": str(interaction.user.id)}})
            
            users_col.update_one({"user_id": str(interaction.user.id)}, 
                                 {"$inc": {"deliver_count_week": 1, "deliver_count_total": 1}}, upsert=True)
            
            await update_master_log(order_id)
            await interaction.response.send_message("✅ Check DMs.", ephemeral=True)
        except: await interaction.response.send_message("❌ Open DMs.", ephemeral=True)
    else:
        target = None
        for c in guild.text_channels:
            if c.permissions_for(guild.me).send_messages: target = c; break
        if target:
            await target.send(f"🤖 **Auto-Delivery** (Invite Failed)\n{msg}")
            orders_col.update_one({"order_id": order_id}, {"$set": {"status": "delivered", "deliverer_id": "AUTO_FALLBACK"}})
            await update_master_log(order_id)
            await interaction.response.send_message("⚠️ Invite failed. I auto-delivered it.", ephemeral=True)
        else: await interaction.response.send_message("❌ Failed. Server locked down.", ephemeral=True)

@bot.tree.command(name="setscript", description="Set custom delivery script")
async def setscript(interaction: discord.Interaction, message: str):
    scripts_col.update_one({"user_id": str(interaction.user.id)}, {"$set": {"script": message}}, upsert=True)
    await interaction.response.send_message("Saved!", ephemeral=True)

@bot.tree.command(name="addvip", description="Owner: Give VIP")
async def addvip(interaction: discord.Interaction, user: discord.User):
    if interaction.user.id != OWNER_ID: return await interaction.response.send_message("Owner only.", ephemeral=True)
    premium_col.update_one({"user_id": str(user.id)}, {"$set": {"is_vip": True}}, upsert=True)
    await interaction.response.send_message(f"💎 Added {user.mention} to VIP.")

@bot.tree.command(name="removevip", description="Owner: Revoke VIP")
async def removevip(interaction: discord.Interaction, user: discord.User):
    if interaction.user.id != OWNER_ID:
        return await interaction.response.send_message("Owner only.", ephemeral=True)
    premium_col.update_one(
        {"user_id": str(user.id)},
        {"$set": {"is_vip": False}, "$unset": {"expires_at": ""}}
    )
    await interaction.response.send_message(f"📉 Removed VIP status from {user.mention}.")

@bot.tree.command(name="unban", description="Management: Remove Ban")
@commands.has_role(MANAGER_ROLE_ID)
async def unban(interaction: discord.Interaction, user: discord.User):
    users_col.update_one({"user_id": str(user.id)}, {"$set": {"is_banned": 0}, "$unset": {"ban_expires_at": ""}})
    wc = bot.get_channel(WARNING_CHANNEL_ID)
    if wc: await wc.send(f"🛡️ **User Unbanned** | User: {user.mention} | By: {interaction.user.mention}")
    await interaction.response.send_message(f"✅ {user.mention} has been unbanned.", ephemeral=True)

@bot.tree.command(name="fdo", description="Post-Cook Force Delete")
@commands.has_role(MANAGER_ROLE_ID)
async def fdo(interaction: discord.Interaction, order_id: str, reason: str):
    o = orders_col.find_one({"order_id": order_id})
    if not o or o['status'] not in ['ready', 'delivered']: return await interaction.response.send_message("Order not cooked yet.", ephemeral=True)
    await apply_warning_logic(interaction, o, reason, "fdo")

async def apply_warning_logic(interaction, order, reason, cmd_type="warn"):
    uid = order['user_id']
    users_col.update_one({"user_id": uid}, {"$inc": {"warnings": 1}}, upsert=True)
    new_status = "cancelled_warn" if cmd_type == "warn" else "cancelled_fdo"
    orders_col.update_one({"order_id": order['order_id']}, {"$set": {"status": new_status}})
    await update_master_log(order['order_id'])
    
    user_data = users_col.find_one({"user_id": uid})
    w = user_data['warnings']
    ban_msg = ""
    
    if w == 3:
        expiry = get_utc_now() + datetime.timedelta(days=7)
        users_col.update_one({"user_id": uid}, {"$set": {"ban_expires_at": expiry}})
        ban_msg = "\n⏳ **7-DAY BAN APPLIED**"
    elif w == 6:
        expiry = get_utc_now() + datetime.timedelta(days=30)
        users_col.update_one({"user_id": uid}, {"$set": {"ban_expires_at": expiry}})
        ban_msg = "\n⏳ **30-DAY BAN APPLIED**"
    elif w >= 9:
        users_col.update_one({"user_id": uid}, {"$set": {"is_banned": 1}})
        ban_msg = "\n🛑 **PERMANENT BAN APPLIED**"

    user_msg = f"⚠️ **Warning Issued**\nReason: {reason}\nStrikes: {w}{ban_msg}"
    if ban_msg: user_msg += f"\n\n🛡️ **Appeal:** {SUPPORT_SERVER_LINK} or {SUPPORT_EMAIL}"
    log_msg = f"⚠️ **User Warned ({cmd_type.upper()})** | User: <@{uid}> | Reason: {reason} | Strikes: {w} {ban_msg}"

    try: 
        u = await bot.fetch_user(int(uid))
        await u.send(user_msg)
    except: pass
    
    wc = bot.get_channel(WARNING_CHANNEL_ID)
    if wc: await wc.send(log_msg)
    
    await interaction.response.send_message(f"Action taken. Strikes: {w}{ban_msg}")

bot.run(BOT_TOKEN)
