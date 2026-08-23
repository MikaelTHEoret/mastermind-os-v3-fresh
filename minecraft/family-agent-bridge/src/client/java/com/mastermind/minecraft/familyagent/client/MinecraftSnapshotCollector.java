package com.mastermind.minecraft.familyagent.client;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionRegistry;
import com.mastermind.minecraft.familyagent.config.FamilyServerAddressPolicy;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.phys.Vec3;

import java.util.TreeMap;
import java.util.UUID;

final class MinecraftSnapshotCollector {
    private MinecraftSnapshotCollector() {
    }

    static String phase(Minecraft minecraft) {
        if (minecraft.player != null && minecraft.level != null) {
            return "in-world";
        }
        if (minecraft.getConnection() != null) {
            return "connecting";
        }
        return "main-menu";
    }

    static JsonObject snapshot(Minecraft minecraft, NavigationProvider navigation, ActionRegistry registry,
                               long clientTick, boolean killSwitch, int familyServerPort, boolean includeInventory) {
        var payload = new JsonObject();
        payload.addProperty("snapshotId", UUID.randomUUID().toString());
        payload.addProperty("clientTick", clientTick);
        payload.addProperty("phase", phase(minecraft));
        if (isFamilyServer(minecraft, familyServerPort)) {
            payload.addProperty("serverAlias", "family-server");
        } else {
            payload.add("serverAlias", JsonNull.INSTANCE);
        }
        addPlayer(payload, minecraft);
        addWorld(payload, minecraft);
        if (includeInventory) {
            addInventory(payload, minecraft);
        }
        payload.add("baritone", navigation.snapshot());
        var active = registry.active();
        if (active.isPresent()) {
            var action = new JsonObject();
            action.addProperty("actionId", active.orElseThrow().actionId().toString());
            action.addProperty("kind", active.orElseThrow().kind());
            action.addProperty("status", "started");
            payload.add("activeAction", action);
        } else {
            payload.add("activeAction", JsonNull.INSTANCE);
        }
        var safety = new JsonObject();
        safety.addProperty("killSwitch", killSwitch);
        payload.add("safety", safety);
        return payload;
    }

    private static void addInventory(JsonObject payload, Minecraft minecraft) {
        var player = minecraft.player;
        if (player == null || minecraft.level == null) {
            payload.add("inventory", JsonNull.INSTANCE);
            return;
        }
        var totals = new TreeMap<String, Integer>();
        player.getInventory().getNonEquipmentItems().stream()
            .filter(stack -> !stack.isEmpty())
            .forEach(stack -> totals.merge(
                BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
                stack.getCount(),
                (left, right) -> Math.min(4_096, left + right)
            ));
        var items = new com.google.gson.JsonArray();
        totals.forEach((itemId, count) -> {
            var item = new JsonObject();
            item.addProperty("itemId", itemId);
            item.addProperty("count", count);
            items.add(item);
        });
        var inventory = new JsonObject();
        inventory.add("items", items);
        payload.add("inventory", inventory);
    }

    static boolean isFamilyServer(Minecraft minecraft, int familyServerPort) {
        if (minecraft.player == null || minecraft.level == null || minecraft.getConnection() == null) {
            return false;
        }
        var server = minecraft.getCurrentServer();
        if (server == null) {
            return false;
        }
        return FamilyServerAddressPolicy.isTrusted(server.ip, familyServerPort);
    }

    private static void addPlayer(JsonObject payload, Minecraft minecraft) {
        var player = minecraft.player;
        if (player == null || minecraft.level == null) {
            payload.add("player", JsonNull.INSTANCE);
            return;
        }
        var value = new JsonObject();
        value.add("position", vector(player.position()));
        value.add("velocity", vector(clampVelocity(player.getDeltaMovement())));
        value.addProperty("yaw", wrapDegrees(player.getYRot()));
        value.addProperty("pitch", Math.max(-90.0F, Math.min(90.0F, player.getXRot())));
        var maxHealth = Math.min(2_048.0F, Math.max(1.0F, player.getMaxHealth()));
        value.addProperty("health", Math.max(0.0F, Math.min(maxHealth, player.getHealth())));
        value.addProperty("maxHealth", maxHealth);
        value.addProperty("hunger", Math.max(0, Math.min(20, player.getFoodData().getFoodLevel())));
        value.addProperty("armor", Math.max(0, Math.min(30, player.getArmorValue())));
        value.addProperty("dimension", minecraft.level.dimension().identifier().toString());
        payload.add("player", value);
    }

    private static void addWorld(JsonObject payload, Minecraft minecraft) {
        var level = minecraft.level;
        if (level == null) {
            payload.add("world", JsonNull.INSTANCE);
            return;
        }
        var value = new JsonObject();
        value.addProperty("timeOfDay", Math.floorMod(level.getOverworldClockTime(), 24_000L));
        value.addProperty("weather", level.isThundering() ? "thunder" : level.isRaining() ? "rain" : "clear");
        payload.add("world", value);
    }

    private static JsonObject vector(Vec3 vector) {
        var value = new JsonObject();
        value.addProperty("x", vector.x);
        value.addProperty("y", vector.y);
        value.addProperty("z", vector.z);
        return value;
    }

    private static Vec3 clampVelocity(Vec3 vector) {
        return new Vec3(clamp(vector.x, 1_024), clamp(vector.y, 1_024), clamp(vector.z, 1_024));
    }

    private static double clamp(double value, double absoluteLimit) {
        return Math.max(-absoluteLimit, Math.min(absoluteLimit, value));
    }

    private static float wrapDegrees(float value) {
        var wrapped = value % 360.0F;
        if (wrapped >= 180.0F) wrapped -= 360.0F;
        if (wrapped < -180.0F) wrapped += 360.0F;
        return wrapped;
    }
}
