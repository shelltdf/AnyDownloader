import './style.css'
import { applyStoredThemeOnBoot } from './composables/useTheme'
import { createApp } from 'vue'
import App from './App.vue'

applyStoredThemeOnBoot()

createApp(App).mount('#app')
