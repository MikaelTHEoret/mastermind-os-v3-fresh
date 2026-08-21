package com.mastermind.minecraft.familyagent.client;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.config.BridgeConfig;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import com.mastermind.minecraft.familyagent.protocol.BridgeProtocol;
import com.mastermind.minecraft.familyagent.protocol.ClientPayloads;
import com.mastermind.minecraft.familyagent.protocol.ControlMessage;
import com.mastermind.minecraft.familyagent.safety.KillSwitchLatch;
import com.mastermind.minecraft.familyagent.transport.LocalBridgeWebSocket;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class FamilyBridgeRuntime implements LocalBridgeWebSocket.Listener, AutoCloseable {
    private final Minecraft minecraft;
    private final NavigationProvider navigation;
    private final Set<String> capabilities;
    private final LocalBridgeWebSocket transport;
    private final MinecraftActionController actions;
    private final int familyServerPort;
    private final ConcurrentLinkedQueue<ControlMessage> incoming = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> disconnects = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<Boolean> readySignals = new ConcurrentLinkedQueue<>();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final KillSwitchLatch killSwitch = new KillSwitchLatch();

    private long clientTick;
    private long lastHeartbeatNanos;
    private long lastSnapshotNanos;
    private boolean wasInFamilyWorld;
    private boolean emergencyKeyWasDown;
    private boolean shutdownRequested;
    private long stopAfterTick = Long.MAX_VALUE;

    FamilyBridgeRuntime(Minecraft minecraft, BridgeConfig config, NavigationProvider navigation) {
        this.minecraft = minecraft;
        this.navigation = navigation;
        familyServerPort = config.familyServerPort();
        var offered = new LinkedHashSet<>(BridgeProtocol.BASE_CAPABILITIES);
        offered.addAll(navigation.capabilities());
        capabilities = Set.copyOf(offered);
        actions = new MinecraftActionController(minecraft, navigation, this::send, familyServerPort);
        transport = new LocalBridgeWebSocket(config, this, capabilities);
    }

    void start() {
        transport.start();
    }

    void tick() {
        if (closed.get()) {
            return;
        }
        clientTick++;
        var nowNanos = System.nanoTime();
        var emergencyKeyDown = InputConstants.isKeyDown(minecraft.getWindow(), InputConstants.KEY_F8);
        if (emergencyKeyDown && !emergencyKeyWasDown && killSwitch.engage()) {
            actions.engageKillSwitch();
        }
        emergencyKeyWasDown = emergencyKeyDown;
        var inFamilyWorld = MinecraftSnapshotCollector.isFamilyServer(minecraft, familyServerPort);
        if (wasInFamilyWorld && !inFamilyWorld) {
            actions.deadMan("connection-lost");
        }
        wasInFamilyWorld = inFamilyWorld;
        drainDisconnects();
        drainControl(nowNanos);
        if (readySignals.poll() != null) {
            lastHeartbeatNanos = 0;
            lastSnapshotNanos = 0;
            readySignals.clear();
        }
        actions.tick(nowNanos);
        transport.checkLiveness(nowNanos);
        if (clientTick >= stopAfterTick) {
            minecraft.stop();
            return;
        }
        if (!transport.isReady()) {
            return;
        }
        if (nowNanos - lastHeartbeatNanos >= TimeUnit.MILLISECONDS.toNanos(transport.heartbeatIntervalMs())) {
            var activeId = actions.registry().active().map(active -> active.actionId()).orElse(null);
            transport.send("bridge.heartbeat", ClientPayloads.heartbeat(
                clientTick, MinecraftSnapshotCollector.phase(minecraft), activeId, killSwitch.isEngaged()
            ));
            lastHeartbeatNanos = nowNanos;
        }
        if (transport.supports("state.snapshot")
            && nowNanos - lastSnapshotNanos >= TimeUnit.MILLISECONDS.toNanos(transport.snapshotIntervalMs())) {
            transport.sendSnapshot(MinecraftSnapshotCollector.snapshot(
                minecraft, navigation, actions.registry(), clientTick, killSwitch.isEngaged(), familyServerPort
            ));
            lastSnapshotNanos = nowNanos;
        }
    }

    @Override
    public JsonObject bridgeHelloPayload() {
        var loader = FabricLoader.getInstance();
        return ClientPayloads.hello(
            ProcessHandle.current().pid(),
            version(loader, "mastermind-family-agent-bridge", "0.1.0"),
            version(loader, "minecraft", "26.2"),
            version(loader, "fabricloader", "0.19.3"),
            navigation.implementationVersion(),
            capabilities
        );
    }

    @Override
    public void onReady(ControlMessage.Ready ready) {
        readySignals.add(Boolean.TRUE);
    }

    @Override
    public void onControl(ControlMessage message) {
        incoming.add(message);
    }

    @Override
    public void onDisconnected(String reason) {
        disconnects.add("connection-lost");
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        actions.deadMan("client-shutdown");
        transport.close();
    }

    private void drainDisconnects() {
        while (disconnects.poll() != null) {
            actions.deadMan("connection-lost");
        }
    }

    private void drainControl(long nowNanos) {
        for (ControlMessage message; (message = incoming.poll()) != null;) {
            if (shutdownRequested) {
                continue;
            }
            switch (message) {
                case ControlMessage.Execute execute -> actions.execute(execute.action(), nowNanos);
                case ControlMessage.Cancel cancel -> actions.cancel(cancel.actionId(), cancel.reason());
                case ControlMessage.Shutdown shutdown -> handleShutdown(shutdown);
                case ControlMessage.Hello ignored -> throw new IllegalStateException("Repeated control.hello escaped transport validation");
                case ControlMessage.Ready ignored -> throw new IllegalStateException("Repeated control.ready escaped transport validation");
            }
        }
    }

    private void handleShutdown(ControlMessage.Shutdown shutdown) {
        shutdownRequested = true;
        actions.deadMan("client-shutdown");
        transport.send("client.shutdownAck", ClientPayloads.shutdownAck(shutdown.shutdownId()));
        stopAfterTick = Math.min(stopAfterTick, clientTick + 1);
    }

    private void send(String type, JsonObject payload) {
        transport.send(type, payload);
    }

    private static String version(FabricLoader loader, String modId, String fallback) {
        return loader.getModContainer(modId)
            .map(container -> container.getMetadata().getVersion().getFriendlyString())
            .filter(value -> value.matches("^[0-9A-Za-z][0-9A-Za-z._+\\-]{0,63}$"))
            .orElse(fallback);
    }
}
