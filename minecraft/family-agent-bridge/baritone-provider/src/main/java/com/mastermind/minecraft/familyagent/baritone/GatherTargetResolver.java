package com.mastermind.minecraft.familyagent.baritone;

final class GatherTargetResolver {
    private GatherTargetResolver() {
    }

    static String expectedItemId(String blockId) {
        return switch (blockId) {
            case "minecraft:coal_ore", "minecraft:deepslate_coal_ore" -> "minecraft:coal";
            case "minecraft:iron_ore", "minecraft:deepslate_iron_ore" -> "minecraft:raw_iron";
            case "minecraft:stone" -> "minecraft:cobblestone";
            default -> blockId;
        };
    }
}
