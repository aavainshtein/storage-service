# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем рабочую директорию в контейнере
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем остальной код приложения
COPY . .

# Собираем приложение (для production)
RUN npm run build

# Открываем порт
EXPOSE 8000

# Запускаем приложение
CMD ["node", "dist/main"]