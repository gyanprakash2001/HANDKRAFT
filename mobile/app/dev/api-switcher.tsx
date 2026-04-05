import React from 'react';
import { View, StyleSheet } from 'react-native';
import ApiSwitcher from '@/components/ApiSwitcher';

export default function DevApiSwitcher() {
  return (
    <View style={styles.container}>
      <ApiSwitcher />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
});
