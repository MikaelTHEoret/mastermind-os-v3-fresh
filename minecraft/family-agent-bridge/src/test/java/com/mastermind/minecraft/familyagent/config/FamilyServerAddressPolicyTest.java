package com.mastermind.minecraft.familyagent.config;

import org.junit.jupiter.api.Test;

import java.net.InetAddress;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class FamilyServerAddressPolicyTest {
    @Test
    void acceptsLoopbackAndAnExactLocalLanAddressOnTheFamilyPort() throws Exception {
        var localLan = InetAddress.getByName("10.10.10.39");

        assertTrue(FamilyServerAddressPolicy.isTrusted("127.0.0.1:25565", 25_565, ignored -> false));
        assertTrue(FamilyServerAddressPolicy.isTrusted("localhost", 25_565, ignored -> false));
        assertTrue(FamilyServerAddressPolicy.isTrusted("10.10.10.39:25565", 25_565, localLan::equals));
    }

    @Test
    void rejectsRemoteHostsWrongPortsAndDnsNames() throws Exception {
        var localLan = InetAddress.getByName("10.10.10.39");

        assertFalse(FamilyServerAddressPolicy.isTrusted("10.10.10.40:25565", 25_565, localLan::equals));
        assertFalse(FamilyServerAddressPolicy.isTrusted("10.10.10.39:25566", 25_565, localLan::equals));
        assertFalse(FamilyServerAddressPolicy.isTrusted("play.example.test:25565", 25_565, ignored -> true));
        assertFalse(FamilyServerAddressPolicy.isTrusted("127.0.0.1:not-a-port", 25_565, ignored -> true));
    }
}
