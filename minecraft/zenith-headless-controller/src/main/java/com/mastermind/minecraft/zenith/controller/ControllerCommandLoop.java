package com.mastermind.minecraft.zenith.controller;

import org.geysermc.mcprotocollib.network.Session;
import org.geysermc.mcprotocollib.protocol.packet.ingame.serverbound.ServerboundChatPacket;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;

final class ControllerCommandLoop implements Runnable {
    private final InputStream input;
    private final Session session;
    private final AtomicBoolean cleanStop;

    ControllerCommandLoop(InputStream input, Session session, AtomicBoolean cleanStop) {
        this.input = input;
        this.session = session;
        this.cleanStop = cleanStop;
    }

    @Override
    public void run() {
        while (session.isConnected()) {
            final String line;
            try {
                line = BoundedLineReader.read(input, ControllerCommand.MAX_INPUT_BYTES);
            } catch (IOException error) {
                reject("COMMAND_INPUT_INVALID");
                return;
            }
            // Existing observation-only launchers close stdin after the launch envelope.
            // EOF preserves their bounded hold behavior and advertises no command result.
            if (line == null) return;
            final ControllerCommand command;
            try {
                command = ControllerCommand.parse(line);
            } catch (RuntimeException error) {
                reject("COMMAND_REJECTED");
                return;
            }
            try {
                session.send(new ServerboundChatPacket(command.text()));
                SafeStatus.emit("COMMAND", "CHAT_SENT");
            } catch (RuntimeException error) {
                reject("COMMAND_SEND_FAILED");
                return;
            }
        }
    }

    private void reject(String code) {
        SafeStatus.emit("FAILED", code);
        if (session.isConnected()) {
            cleanStop.set(true);
            session.disconnect("Mastermind controller command channel closed safely");
        }
    }
}
