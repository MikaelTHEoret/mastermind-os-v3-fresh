package com.mastermind.minecraft.familycore.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mastermind.minecraft.familycore.FamilyCoreMod;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public final class FamilyCoreBridgeRuntime implements FamilyCoreWebSocket.Listener, AutoCloseable {
    private final MinecraftServer server;
    private final ServerBridgeConfig config;
    private final Logger logger;
    private final boolean computerCommandEnabled;
    private final FamilyCoreWebSocket transport;
    private final FamilyCoreHeartbeatLoop heartbeatLoop;
    private final AtomicInteger playerCount = new AtomicInteger();
    private final Map<UUID, UUID> pendingComputerRequests = new ConcurrentHashMap<>();
    private final long startedAtNanos = System.nanoTime();

    public FamilyCoreBridgeRuntime(MinecraftServer server, ServerBridgeConfig config, boolean computerCommandEnabled, Logger logger) {
        this.server = server;
        this.config = config;
        this.logger = logger;
        this.computerCommandEnabled = computerCommandEnabled;
        this.transport = new FamilyCoreWebSocket(config, this);
        this.heartbeatLoop = new FamilyCoreHeartbeatLoop(config.heartbeatTicks(), () -> transport.heartbeat(
            Math.max(0, (System.nanoTime() - startedAtNanos) / 1_000_000L),
            playerCount.get()
        ));
    }

    public void start() {
        transport.start();
        heartbeatLoop.start();
    }

    public void tick() {
        playerCount.set(server.getPlayerList().getPlayerCount());
    }

    public boolean requestComputer(ServerPlayer player, String text) {
        JsonObject identity = new JsonObject();
        identity.addProperty("minecraftUuid", player.getUUID().toString());
        identity.addProperty("displayName", player.getGameProfile().name());
        identity.addProperty("role", "guest");
        identity.addProperty("identityBound", false);
        JsonObject payload = new JsonObject();
        payload.add("player", identity);
        payload.addProperty("text", text);
        UUID requestId = transport.send("computer.requested", payload, null);
        if (requestId == null) return false;
        pendingComputerRequests.put(requestId, player.getUUID());
        return true;
    }

    public String status() {
        return transport.status();
    }

    @Override
    public JsonObject helloPayload() {
        JsonObject payload = new JsonObject();
        payload.addProperty("serverId", "family-server");
        payload.addProperty("instanceId", config.instanceId().toString());
        payload.addProperty("modVersion", FabricLoader.getInstance().getModContainer(FamilyCoreMod.MOD_ID)
            .orElseThrow().getMetadata().getVersion().getFriendlyString());
        payload.addProperty("minecraftVersion", FabricLoader.getInstance().getModContainer("minecraft")
            .orElseThrow().getMetadata().getVersion().getFriendlyString());
        JsonArray capabilities = new JsonArray();
        if (computerCommandEnabled) capabilities.add("computer.request");
        payload.add("capabilities", capabilities);
        payload.addProperty("commandEnabled", computerCommandEnabled);
        return payload;
    }

    @Override
    public void onReady() {
        logger.info("Authenticated Family Core server bridge connected");
    }

    @Override
    public void onControl(FamilyCoreCodec.ControlFrame frame) {
        server.execute(() -> applyControl(frame));
    }

    private void applyControl(FamilyCoreCodec.ControlFrame frame) {
        JsonObject payload = frame.payload();
        switch (frame.type()) {
            case "computer.broadcast" -> server.getPlayerList().broadcastSystemMessage(
                Component.literal(computerText(payload.get("text").getAsString())), false
            );
            case "computer.private" -> {
                UUID playerId = UUID.fromString(payload.get("minecraftUuid").getAsString());
                ServerPlayer player = server.getPlayerList().getPlayer(playerId);
                if (player != null) player.sendSystemMessage(Component.literal(computerText(payload.get("text").getAsString())));
            }
            case "computer.requestStatus" -> {
                UUID requestId = UUID.fromString(payload.get("requestId").getAsString());
                UUID playerId = pendingComputerRequests.get(requestId);
                if (playerId != null) {
                    ServerPlayer player = server.getPlayerList().getPlayer(playerId);
                    if (player != null) player.sendSystemMessage(Component.literal(computerText(payload.get("message").getAsString())));
                    String status = payload.get("status").getAsString();
                    if (Set.of("completed", "rejected", "failed").contains(status)) pendingComputerRequests.remove(requestId);
                }
            }
            default -> throw new IllegalArgumentException("Unsupported Family Core control message");
        }
    }

    @Override
    public void onDisconnected(String reason) {
        logger.warn("Family Core server bridge disconnected ({})", reason);
    }

    @Override
    public void close() {
        heartbeatLoop.close();
        transport.close();
        pendingComputerRequests.clear();
    }

    private static String computerText(String text) {
        return text.startsWith("[Computer]") ? text : "[Computer] " + text;
    }
}
