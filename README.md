# ¿Qué sucede después? — Edición Deluxe 🎬🍿

Aplicación web multijugador en tiempo real inspirada en el concurso de televisión *¿Qué sucede después?* (segmento de *Hora de Comer*), diseñada para eventos en vivo, salas de clases, fiestas, **Zoom** y **OBS**.

## ✨ Novedades de la Edición Deluxe

1. **🎬 Reproductor de Video Integrado + Modo Externo (OBS/VLC)**:
   - Cada ronda permite configurar opcionalmente una URL de video (`videoUrl`, como el clip incluido `/demo.mp4`), un segundo exacto de **corte automático** (`cutTime`) y un tiempo final (`endTime`).
   - En la **Pantalla Gigante**, durante la fase *"Mira la escena"*, el video se reproduce y se pausa automáticamente en el instante del suspenso. Al cerrar las votaciones, el video continúa desde el corte revelando el desenlace.
2. **🔊 Motor de Sonido Sintetizado (Web Audio API) y Confeti**:
   - Efectos de sonido generados en tiempo real sin archivos pesados: tic-tac de reloj en los últimos 10 segundos, alerta urgente en los últimos 5 segundos, apertura de votaciones, bocina de cierre, fanfarria de revelación y acorde de podio.
   - Botón rápido en cabecera para activar/silenciar (`🔊 Sonido / 🔇 Silencio`) y modo **Pantalla Completa** (`⛶`).
   - Lluvia de confeti animada en Canvas al acertar y al mostrar el Gran Podio Final.
3. **📊 Gráfico de Distribución de Votos en Vivo**:
   - Al revelar resultados, tanto la Pantalla Gigante como los jugadores y el Director ven barras de progreso animadas con el porcentaje y número de votos que recibió cada alternativa (`A`, `B`, `C`, `D`).
4. **🏆 Podio Visual Top 3, Bonos de Velocidad y Racha**:
   - Podio destacado con medallas (`🥇`, `🥈`, `🥉`), avatares y puntajes antes de la tabla general.
   - Configuración por sala para activar **⚡ Bono por rapidez** (hasta +300 puntos adicionales según velocidad de respuesta) y **🔥 Bono por racha consecutiva** (+100, +200, +300 puntos).
5. **🎭 Avatares y Reacciones Flotantes en Tiempo Real**:
   - Los jugadores eligen su avatar al ingresar y pueden enviar reacciones en vivo (`👏`, `😂`, `😱`, `🔥`, `🎉`, `🤔`, `❤️`, `🍿`) que flotan en la Pantalla Gigante.
6. **📦 Banco de Plantillas, Edición y Reordenamiento**:
   - Tres packs listos para usar con un clic: *Pack Demo con Video Integrado*, *Pack Momentos Inesperados del Cine* y *Pack Bloopers y Videos Virales*.
   - Edición completa de preguntas creadas, reordenamiento (`↑` / `↓`), exportación a JSON y reinicio de sala al lobby.

## 🖥️ Tres vistas sincronizadas

- **Pantalla Gigante (`/tv` o `/screen/CODIGO`)**: Vista pública para proyector, TV o captura de ventana en OBS/Zoom.
- **Jugador (`/play` o `/j/CODIGO`)**: Vista móvil rápida para elegir avatar, seleccionar y confirmar alternativa, y enviar reacciones.
- **Administrador / Director (`/admin.html` o `/host/CODIGO`)**: Panel privado protegido por `HOST_KEY` (sesión firmada HttpOnly por 30 días).

## 🚀 Ejecución Local

```bash
npm install
npm test
npm start
```

Abre `http://localhost:3000`. En modo local sin variables de entorno usa memoria temporal y la clave de administrador predeterminada `ensayo-local`.
