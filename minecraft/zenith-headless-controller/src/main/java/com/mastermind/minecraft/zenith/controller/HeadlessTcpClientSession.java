package com.mastermind.minecraft.zenith.controller;

import it.unimi.dsi.fastutil.ints.IntSets;
import org.geysermc.mcprotocollib.network.tcp.TcpClientSession;
import org.geysermc.mcprotocollib.network.tcp.TcpConnectionManager;
import org.geysermc.mcprotocollib.protocol.MinecraftProtocol;
import org.geysermc.mcprotocollib.protocol.data.game.chunk.PalettedWorldState;

/**
 * Supplies the pinned 26.2 palette metadata that MCProtocolLib deliberately
 * leaves to embedding clients. The probe does not retain or interpret chunks,
 * so fluid-state classification is intentionally empty.
 */
final class HeadlessTcpClientSession extends TcpClientSession {
    static final int INITIAL_SECTION_COUNT = 24;
    static final int BLOCK_STATE_REGISTRY_SIZE = 32_366;
    static final int AIR_BLOCK_STATE_ID = 0;
    static final int BIOME_REGISTRY_SIZE = 66;
    static final int PLAINS_BIOME_ID = 40;

    private final PalettedWorldState palettedWorldState = new PalettedWorldState(
        INITIAL_SECTION_COUNT,
        BLOCK_STATE_REGISTRY_SIZE,
        AIR_BLOCK_STATE_ID,
        BIOME_REGISTRY_SIZE,
        PLAINS_BIOME_ID,
        IntSets.emptySet()
    );

    HeadlessTcpClientSession(
        String host,
        int port,
        MinecraftProtocol protocol,
        TcpConnectionManager manager
    ) {
        super(host, port, protocol, manager);
    }

    @Override
    public PalettedWorldState getPalettedWorldState() {
        return palettedWorldState;
    }
}
