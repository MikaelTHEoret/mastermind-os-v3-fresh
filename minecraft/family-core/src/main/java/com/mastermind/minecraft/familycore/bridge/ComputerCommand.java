package com.mastermind.minecraft.familycore.bridge;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mastermind.minecraft.familycore.protocol.FamilyCoreProtocol;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

import java.util.Locale;
import java.util.function.Supplier;

public final class ComputerCommand {
    private ComputerCommand() {}

    public static void register(Supplier<FamilyCoreBridgeRuntime> runtime) {
        CommandRegistrationCallback.EVENT.register((dispatcher, context, selection) -> dispatcher.register(
            Commands.literal("computer")
                .executes(command -> help(command.getSource()))
                .then(Commands.argument("request", StringArgumentType.greedyString())
                    .executes(command -> execute(
                        command.getSource().getPlayerOrException(),
                        runtime.get(),
                        StringArgumentType.getString(command, "request")
                    )))
        ));
    }

    private static int help(net.minecraft.commands.CommandSourceStack source) {
        source.sendSuccess(() -> Component.literal(
            "[Computer] Use /computer status or /computer <request>. Administrative and AI actions remain approval-gated."
        ), false);
        return 1;
    }

    private static int execute(
        net.minecraft.server.level.ServerPlayer player,
        FamilyCoreBridgeRuntime runtime,
        String rawText
    ) {
        final String text;
        try {
            text = FamilyCoreProtocol.requireChatText(rawText.strip());
        } catch (IllegalArgumentException error) {
            player.sendSystemMessage(Component.literal("[Computer] That request is empty, too long, or contains unsafe text."));
            return 0;
        }
        String deterministic = text.toLowerCase(Locale.ROOT);
        if (deterministic.equals("help")) {
            player.sendSystemMessage(Component.literal(
                "[Computer] Use /computer status or /computer <request>. No raw server commands are accepted."
            ));
            return 1;
        }
        if (deterministic.equals("status")) {
            player.sendSystemMessage(Component.literal(
                "[Computer] Server bridge: " + (runtime == null ? "starting" : runtime.status()) + "."
            ));
            return 1;
        }
        if (runtime == null || !runtime.requestComputer(player, text)) {
            player.sendSystemMessage(Component.literal("[Computer] The server bridge is unavailable; nothing was queued."));
            return 0;
        }
        player.sendSystemMessage(Component.literal("[Computer] Request received."));
        return 1;
    }
}
