package com.mastermind.minecraft.zenith.bootstrap;

import java.io.InputStream;
import java.io.PrintStream;
import java.util.Arrays;
import java.util.Locale;

public final class SecureZenithBootstrapMain {
    static final String ZENITH_MAIN_CLASS = "com.zenith.Proxy";
    static final String USERNAME_PROPERTY = "mastermind.zenith.session.username";
    static final String UUID_PROPERTY = "mastermind.zenith.session.uuid";
    static final String ACCESS_TOKEN_PROPERTY = "mastermind.zenith.session.accessToken";
    static final String REQUIRED_PROPERTY = "mastermind.zenith.session.required";

    private SecureZenithBootstrapMain() {}

    public static void main(String[] arguments) {
        int status = run(arguments, System.in, new ReflectiveInvoker(), System.err);
        if (status != 0) System.exit(status);
    }

    static int run(String[] arguments, InputStream credentials, MainInvoker invoker, PrintStream errors) {
        if (arguments == null || arguments.length != 0) return fail(errors, "COMMAND_LINE_ARGUMENTS_FORBIDDEN", 64);
        if (propertyPresent(USERNAME_PROPERTY) || propertyPresent(UUID_PROPERTY) || propertyPresent(ACCESS_TOKEN_PROPERTY)
            || propertyPresent(REQUIRED_PROPERTY)) {
            clearProperties();
            return fail(errors, "PRESEEDED_CREDENTIAL_PROPERTY_FORBIDDEN", 65);
        }
        try (CredentialFrame frame = CredentialFrameReader.readAndClose(credentials)) {
            String username = new String(frame.username());
            String uuid = canonicalUuid(new String(frame.uuid()));
            String accessToken = new String(frame.accessToken());
            try {
                System.setProperty(USERNAME_PROPERTY, username);
                System.setProperty(UUID_PROPERTY, uuid);
                System.setProperty(ACCESS_TOKEN_PROPERTY, accessToken);
                System.setProperty(REQUIRED_PROPERTY, "true");
                invoker.invoke(ZENITH_MAIN_CLASS);
                return 0;
            } finally {
                clearProperties();
            }
        } catch (Exception | LinkageError error) {
            return fail(errors, "SECURE_BOOTSTRAP_FAILED", 70);
        } finally {
            if (arguments != null) Arrays.fill(arguments, null);
            clearProperties();
        }
    }

    private static boolean propertyPresent(String name) {
        return System.getProperty(name) != null;
    }

    private static String canonicalUuid(String value) {
        boolean compactForm = value.length() == 32;
        boolean hyphenatedForm = value.length() == 36
            && value.charAt(8) == '-' && value.charAt(13) == '-'
            && value.charAt(18) == '-' && value.charAt(23) == '-';
        if (!compactForm && !hyphenatedForm) throw new IllegalArgumentException("Invalid Minecraft profile UUID");
        String compact = value.replace("-", "");
        if (compact.length() != 32) throw new IllegalArgumentException("Invalid Minecraft profile UUID");
        for (int index = 0; index < compact.length(); index += 1) {
            if (Character.digit(compact.charAt(index), 16) < 0) {
                throw new IllegalArgumentException("Invalid Minecraft profile UUID");
            }
        }
        String lower = compact.toLowerCase(Locale.ROOT);
        return lower.substring(0, 8) + "-" + lower.substring(8, 12) + "-" + lower.substring(12, 16)
            + "-" + lower.substring(16, 20) + "-" + lower.substring(20);
    }

    private static void clearProperties() {
        System.clearProperty(USERNAME_PROPERTY);
        System.clearProperty(UUID_PROPERTY);
        System.clearProperty(ACCESS_TOKEN_PROPERTY);
        System.clearProperty(REQUIRED_PROPERTY);
    }

    private static int fail(PrintStream errors, String code, int status) {
        if (errors != null) errors.println("Mastermind Zenith bootstrap failed [" + code + "]");
        return status;
    }

    @FunctionalInterface
    interface MainInvoker {
        void invoke(String mainClass) throws Exception;
    }

    private static final class ReflectiveInvoker implements MainInvoker {
        @Override
        public void invoke(String mainClass) throws Exception {
            Class<?> target = Class.forName(mainClass, true, Thread.currentThread().getContextClassLoader());
            target.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
        }
    }
}
