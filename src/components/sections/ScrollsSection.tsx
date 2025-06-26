              <TabsContent value="editor" className="mt-6">
                <ScrollEditor 
                  selectedFile={selectedFile}
                  setSelectedFile={setSelectedFile}
                  addTerminalLine={addTerminalLine}
                  theme={{
                    primaryColor: themeColors.primary_cyan,
                    secondaryColor: themeColors.text_secondary,
                    accentColor: themeColors.mystical_magenta,
                    borderColor: themeColors.border_primary,
                    textColor: themeColors.primary_cyan,
                    cardBackground: themeColors.background_secondary
                  }}
                />
              </TabsContent>