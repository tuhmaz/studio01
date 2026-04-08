import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { COLORS } from '@/utils/constants';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Fehler', 'Bitte E-Mail und Passwort eingeben.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e: any) {
      Alert.alert('Anmeldung fehlgeschlagen', e?.message || 'Ungültige Anmeldedaten.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo / Brand */}
        <View style={styles.brand}>
          <View style={styles.logoBox}>
            <Ionicons name="construct" size={40} color="#fff" />
          </View>
          <Text style={styles.brandTitle}>HAUSMEISTER PRO</Text>
          <Text style={styles.brandSub}>Mitarbeiter-App</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Anmelden</Text>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>E-Mail</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="name@firma.de"
                placeholderTextColor={COLORS.textLight}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Passwort</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="••••••••"
                placeholderTextColor={COLORS.textLight}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPass(v => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Login button */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.loginBtnText}>Anmelden</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>© 2026 Tuhmaz Hausmeister Pro</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.primary },
  scroll:       { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand:        { alignItems: 'center', marginBottom: 36 },
  logoBox:      {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  brandTitle:   { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  brandSub:     { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: '600' },
  card:         {
    backgroundColor: '#fff', borderRadius: 24,
    padding: 28, shadowColor: '#000',
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  cardTitle:    { fontSize: 20, fontWeight: '900', color: COLORS.text, marginBottom: 24 },
  fieldGroup:   { marginBottom: 16 },
  label:        { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  inputWrap:    {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 12, backgroundColor: '#f8fafc', height: 52,
  },
  inputIcon:    { paddingHorizontal: 12 },
  input:        { flex: 1, fontSize: 15, color: COLORS.text, paddingRight: 12 },
  eyeBtn:       { paddingHorizontal: 12 },
  loginBtn:     {
    backgroundColor: COLORS.primary, borderRadius: 14,
    height: 54, justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText:     { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  footer:           { textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 28 },
});
