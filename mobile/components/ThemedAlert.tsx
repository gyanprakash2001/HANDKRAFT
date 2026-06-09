import React from 'react';
import { StyleSheet, View, Modal, TouchableOpacity } from 'react-native';
import { ThemedText } from './themed-text';
import { Ionicons } from '@expo/vector-icons';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface ThemedAlertProps {
  visible: boolean;
  title: string;
  message: string;
  buttons?: AlertButton[];
  onClose: () => void;
}

export function ThemedAlert({ visible, title, message, buttons = [], onClose }: ThemedAlertProps) {
  const handleButtonPress = (onPress?: () => void) => {
    onClose();
    if (onPress) {
      setTimeout(() => {
        onPress();
      }, 100);
    }
  };

  const hasButtons = buttons && buttons.length > 0;
  const displayButtons = hasButtons ? buttons : [{ text: 'OK', style: 'default' as const }];

  let iconName: keyof typeof Ionicons.glyphMap = 'information-circle';
  let iconColor = '#2196F3';
  const lowerTitle = title.toLowerCase();
  const lowerMessage = message.toLowerCase();

  if (
    lowerTitle.includes('error') || 
    lowerTitle.includes('fail') || 
    lowerTitle.includes('weak') ||
    lowerMessage.includes('error') || 
    lowerMessage.includes('fail') || 
    lowerMessage.includes('invalid')
  ) {
    iconName = 'alert-circle';
    iconColor = '#ff6b6b';
  } else if (lowerTitle.includes('logout') || lowerTitle.includes('sign out')) {
    iconName = 'log-out-outline';
    iconColor = '#ff6b6b';
  } else if (lowerTitle.includes('phone') || lowerTitle.includes('number')) {
    iconName = 'call-outline';
    iconColor = '#2196F3';
  } else if (lowerTitle.includes('success') || lowerMessage.includes('success')) {
    iconName = 'checkmark-circle';
    iconColor = '#9df0a2';
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name={iconName} size={32} color={iconColor} />
          </View>
          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText style={styles.message}>{message}</ThemedText>
          
          <View style={[styles.buttonRow, displayButtons.length > 2 && styles.buttonCol]}>
            {displayButtons.map((btn, idx) => {
              const isCancel = btn.style === 'cancel';
              const isDestructive = btn.style === 'destructive';
              
              let btnStyle: any = styles.btnDefault;
              let txtStyle: any = styles.btnTextDefault;
              
              if (isCancel) {
                btnStyle = styles.btnCancel;
                txtStyle = styles.btnTextCancel;
              } else if (isDestructive) {
                btnStyle = styles.btnDestructive;
                txtStyle = styles.btnTextDestructive;
              }
              
              return (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.button,
                    btnStyle,
                    displayButtons.length > 2 
                      ? { width: '100%', marginVertical: 4 } 
                      : { flex: 1, marginHorizontal: 6 }
                  ]}
                  onPress={() => handleButtonPress(btn.onPress)}
                >
                  <ThemedText style={[styles.btnText, txtStyle]}>{btn.text}</ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: '#0b1118',
    borderWidth: 1,
    borderColor: '#1e2b38',
    minWidth: 280,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 43, 56, 0.6)',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1e2b38',
  },
  title: {
    color: '#f5fbff',
    fontWeight: '700',
    fontSize: 18,
    letterSpacing: 0.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    color: '#9fb0c1',
    fontWeight: '500',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  buttonCol: {
    flexDirection: 'column',
  },
  button: {
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnDefault: {
    backgroundColor: '#2196F3',
  },
  btnCancel: {
    backgroundColor: '#1b2631',
    borderWidth: 1,
    borderColor: '#2e3d4d',
  },
  btnDestructive: {
    backgroundColor: '#ff6b6b',
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  btnTextDefault: {
    color: '#ffffff',
  },
  btnTextCancel: {
    color: '#9fb0c1',
  },
  btnTextDestructive: {
    color: '#ffffff',
  },
});
