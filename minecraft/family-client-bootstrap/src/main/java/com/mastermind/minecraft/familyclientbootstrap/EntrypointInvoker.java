package com.mastermind.minecraft.familyclientbootstrap;

@FunctionalInterface
interface EntrypointInvoker {
    void invoke(String className, String[] arguments) throws BootstrapFailure;
}

