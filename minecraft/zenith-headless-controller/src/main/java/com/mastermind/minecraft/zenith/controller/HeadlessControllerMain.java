package com.mastermind.minecraft.zenith.controller;

import org.geysermc.mcprotocollib.auth.GameProfile;
import org.geysermc.mcprotocollib.network.Session;
import org.geysermc.mcprotocollib.network.event.session.SessionAdapter;
import org.geysermc.mcprotocollib.network.packet.Packet;
import org.geysermc.mcprotocollib.network.tcp.TcpConnectionManager;
import org.geysermc.mcprotocollib.protocol.ClientListener;
import org.geysermc.mcprotocollib.protocol.MinecraftProtocol;
import org.geysermc.mcprotocollib.protocol.codec.MinecraftCodec;
import org.geysermc.mcprotocollib.protocol.data.ProtocolState;
import org.geysermc.mcprotocollib.protocol.packet.ingame.clientbound.ClientboundLoginPacket;
import org.geysermc.mcprotocollib.protocol.packet.login.clientbound.ClientboundLoginFinishedPacket;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class HeadlessControllerMain {
    private HeadlessControllerMain() {}

    public static void main(String[] args) {
        if (args.length != 0) {
            SafeStatus.emit("FAILED", "COMMAND_LINE_ARGUMENTS_FORBIDDEN");
            System.exit(2);
        }
        final LaunchEnvelope launch;
        try {
            launch = LaunchEnvelope.parse(BoundedLineReader.read(System.in, LaunchEnvelope.MAX_INPUT_BYTES));
        } catch (Exception error) {
            SafeStatus.emit("FAILED", "INVALID_LAUNCH_ENVELOPE");
            System.exit(2);
            return;
        }

        final MinecraftProtocol protocol = new MinecraftProtocol(
            MinecraftCodec.CODEC,
            new GameProfile(launch.profileId(), launch.profile.name),
            "online".equals(launch.mode) ? launch.accessToken : null
        );
        // Remove the only retained reference from our launch object before the network starts.
        launch.accessToken = null;

        var manager = new TcpConnectionManager(1);
        var loginFinished = new CountDownLatch(1);
        var loginOrDisconnected = new CountDownLatch(1);
        var playReady = new CountDownLatch(1);
        var readyOrDisconnected = new CountDownLatch(1);
        var disconnected = new CountDownLatch(1);
        var cleanStop = new AtomicBoolean(false);
        var session = new HeadlessTcpClientSession(launch.host, launch.port, protocol, manager);
        session.setConnectTimeout(10);
        session.setReadTimeout(30);
        session.setWriteTimeout(10);
        // Zenith's pinned MCProtocolLib fork leaves its default protocol listeners disabled
        // so proxy internals can supply custom handlers. A standalone controller must attach
        // the stock login/configuration listener explicitly or it only opens a TCP socket.
        session.addListener(new ClientListener(ProtocolState.LOGIN, false));
        session.addListener(new SessionAdapter() {
            @Override
            public void connected(Session connectedSession) {
                SafeStatus.emit("CONNECTED", "TCP_CONNECTED");
            }

            @Override
            public void packetReceived(Session connectedSession, Packet packet) {
                if (packet instanceof ClientboundLoginFinishedPacket) {
                    loginFinished.countDown();
                    loginOrDisconnected.countDown();
                    SafeStatus.emit("AUTHENTICATED", "LOGIN_FINISHED");
                } else if (packet instanceof ClientboundLoginPacket) {
                    playReady.countDown();
                    readyOrDisconnected.countDown();
                    SafeStatus.emit("READY", "PLAY_READY");
                }
            }

            @Override
            public boolean packetError(Session errorSession, Throwable cause) {
                Throwable root = rootCause(cause);
                StackTraceElement[] frames = root.getStackTrace();
                String frame = "UNKNOWN";
                if (frames.length > 0) {
                    String className = frames[0].getClassName();
                    int separator = Math.max(className.lastIndexOf('.'), className.lastIndexOf('$'));
                    frame = className.substring(separator + 1) + "_" + frames[0].getMethodName();
                }
                frame = frame.toUpperCase().replaceAll("[^A-Z0-9]", "_");
                String code = "PACKET_ERROR_" + frame;
                SafeStatus.emit("DIAGNOSTIC", code.length() <= 64 ? code : "PACKET_ERROR_CLASSIFIED");
                return false;
            }

            @Override
            public void disconnected(Session disconnectedSession, net.kyori.adventure.text.Component reason, Throwable cause) {
                disconnected.countDown();
                loginOrDisconnected.countDown();
                readyOrDisconnected.countDown();
                var code = cleanStop.get() ? "CLEAN_STOP" : classifyDisconnect(cause);
                SafeStatus.emit(
                    cleanStop.get() ? "STOPPED" : "DISCONNECTED",
                    code
                );
            }
        });

        int exit = 0;
        try {
            SafeStatus.emit("STARTING", "LOOPBACK_CONNECT");
            session.connect(true, true);
            if (!loginOrDisconnected.await(20, TimeUnit.SECONDS)) {
                SafeStatus.emit("FAILED", "LOGIN_TIMEOUT");
                exit = 3;
            } else if (loginFinished.getCount() != 0) {
                exit = 7;
            } else if (!readyOrDisconnected.await(20, TimeUnit.SECONDS)) {
                SafeStatus.emit("FAILED", "PLAY_READY_TIMEOUT");
                exit = 4;
            } else if (playReady.getCount() != 0) {
                exit = 7;
            } else {
                Thread.ofPlatform()
                    .name("mastermind-controller-commands")
                    .daemon(true)
                    .start(new ControllerCommandLoop(System.in, session, cleanStop));
                if (disconnected.await(launch.holdMillis, TimeUnit.MILLISECONDS)) {
                    exit = cleanStop.get() ? 6 : 7;
                } else {
                    cleanStop.set(true);
                    session.disconnect("Mastermind controller hold complete");
                    disconnected.await(5, TimeUnit.SECONDS);
                }
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            SafeStatus.emit("FAILED", "INTERRUPTED");
            exit = 5;
        } catch (RuntimeException error) {
            SafeStatus.emit("FAILED", "CONNECT_FAILED");
            exit = 6;
        } finally {
            if (session.isConnected()) {
                cleanStop.set(true);
                session.disconnect("Mastermind controller probe shutting down");
            }
            manager.close();
        }
        System.exit(exit);
    }

    private static String classifyDisconnect(Throwable cause) {
        if (cause == null) return "REMOTE_DISCONNECT";
        Throwable root = rootCause(cause);
        String outer = safeClassName(cause);
        String inner = safeClassName(root);
        String code = "NETWORK_" + outer + (inner.equals(outer) ? "" : "_" + inner);
        return code.length() <= 64 ? code : "NETWORK_FAILURE";
    }

    private static String safeClassName(Throwable error) {
        String name = error.getClass().getSimpleName().toUpperCase().replaceAll("[^A-Z0-9]", "_");
        return name.isBlank() ? "FAILURE" : name;
    }

    private static Throwable rootCause(Throwable error) {
        Throwable root = error;
        for (int depth = 0; depth < 8 && root.getCause() != null && root.getCause() != root; depth++) {
            root = root.getCause();
        }
        return root;
    }
}
